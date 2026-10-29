// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SellerCollector, IReceivableVault} from "./SellerCollector.sol";

/// @title ReceivableVault
/// @notice LP pool that advances stablecoin to agent sellers against income that arrives over
/// time through HSP reusable mandates. Each seller has a collector address used as `pay_to`.
/// Incoming payments repay the pool first (principal, then fee); any surplus goes to the seller.
/// Prototype: one active advance per seller, not audited, not upgradeable.
contract ReceivableVault is IReceivableVault, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Active,
        Repaid,
        Defaulted
    }

    struct Advance {
        uint256 principal;
        uint256 fee;
        uint256 repaidPrincipal;
        uint256 repaidFee;
        Status status;
    }

    IERC20 public immutable token;

    address public underwriter;
    uint256 public maxAdvance;

    /// @dev LP-owned value: idle cash + unrepaid principal. Excludes the first-loss reserve.
    uint256 public poolAssets;
    uint256 public totalShares;
    uint256 public reserve;
    uint256 public outstandingPrincipal;

    mapping(address => uint256) public shares;
    mapping(address => address) public collectorOf;
    mapping(address => Advance) public advances;

    event Deposited(address indexed lp, uint256 amount, uint256 sharesMinted);
    event Withdrawn(address indexed lp, uint256 amount, uint256 sharesBurned);
    event ReserveFunded(address indexed from, uint256 amount);
    event SellerRegistered(address indexed seller, address collector);
    event AdvanceIssued(address indexed seller, uint256 principal, uint256 fee);
    event Collected(address indexed seller, uint256 amount, uint256 toPrincipal, uint256 toFee, uint256 toSeller);
    event AdvanceRepaid(address indexed seller);
    event DefaultFlagged(address indexed seller, uint256 loss, uint256 coveredByReserve);
    event Recovered(address indexed seller, uint256 amount);
    event UnderwriterSet(address indexed underwriter);
    event MaxAdvanceSet(uint256 maxAdvance);

    error NotUnderwriter();
    error NotCollector();
    error ZeroAmount();
    error SellerAlreadyRegistered();
    error SellerNotRegistered();
    error AdvanceExists();
    error NoActiveAdvance();
    error ExceedsMaxAdvance();
    error InsufficientIdleCash();
    error InvalidFee();
    error PoolImpaired();
    error InsufficientShares();

    modifier onlyUnderwriter() {
        if (msg.sender != underwriter) revert NotUnderwriter();
        _;
    }

    constructor(IERC20 token_, address owner_, address underwriter_, uint256 maxAdvance_) Ownable(owner_) {
        token = token_;
        underwriter = underwriter_;
        maxAdvance = maxAdvance_;
    }

    // ---------------------------------------------------------------- admin

    function setUnderwriter(address underwriter_) external onlyOwner {
        underwriter = underwriter_;
        emit UnderwriterSet(underwriter_);
    }

    function setMaxAdvance(uint256 maxAdvance_) external onlyOwner {
        maxAdvance = maxAdvance_;
        emit MaxAdvanceSet(maxAdvance_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------------------------------------- LPs

    function deposit(uint256 amount) external nonReentrant whenNotPaused returns (uint256 minted) {
        if (amount == 0) revert ZeroAmount();
        if (totalShares == 0) {
            minted = amount;
        } else {
            if (poolAssets == 0) revert PoolImpaired();
            minted = (amount * totalShares) / poolAssets;
        }
        if (minted == 0) revert ZeroAmount();

        shares[msg.sender] += minted;
        totalShares += minted;
        poolAssets += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, minted);
    }

    function withdraw(uint256 shareAmount) external nonReentrant returns (uint256 amount) {
        if (shareAmount == 0) revert ZeroAmount();
        if (shares[msg.sender] < shareAmount) revert InsufficientShares();
        amount = (shareAmount * poolAssets) / totalShares;
        if (amount > idleCash()) revert InsufficientIdleCash();

        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        poolAssets -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, shareAmount);
    }

    /// @notice Anyone can top up the first-loss reserve. It absorbs default losses before LPs.
    function fundReserve(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        reserve += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveFunded(msg.sender, amount);
    }

    // --------------------------------------------------------------- sellers

    /// @notice Deploys the seller's collector. Use its address as `pay_to` on the HSP order.
    function registerSeller(address seller) external onlyUnderwriter returns (address collector) {
        if (collectorOf[seller] != address(0)) revert SellerAlreadyRegistered();
        collector = address(new SellerCollector(IReceivableVault(address(this)), token, seller));
        collectorOf[seller] = collector;
        emit SellerRegistered(seller, collector);
    }

    function advance(address seller, uint256 amount, uint256 fee)
        external
        nonReentrant
        whenNotPaused
        onlyUnderwriter
    {
        if (collectorOf[seller] == address(0)) revert SellerNotRegistered();
        if (amount == 0) revert ZeroAmount();
        if (fee == 0 || fee > amount) revert InvalidFee();
        if (amount > maxAdvance) revert ExceedsMaxAdvance();
        if (amount > idleCash()) revert InsufficientIdleCash();
        Status s = advances[seller].status;
        if (s == Status.Active) revert AdvanceExists();

        advances[seller] =
            Advance({principal: amount, fee: fee, repaidPrincipal: 0, repaidFee: 0, status: Status.Active});
        outstandingPrincipal += amount;
        token.safeTransfer(seller, amount);
        emit AdvanceIssued(seller, amount, fee);
    }

    /// @notice Called by a seller's collector after it forwards tokens here.
    /// Not pausable, so repayments keep flowing while new advances are halted.
    function recordCollection(address seller, uint256 amount) external nonReentrant {
        if (msg.sender != collectorOf[seller] || msg.sender == address(0)) revert NotCollector();
        Advance storage a = advances[seller];

        if (a.status == Status.Defaulted) {
            // Late payment after default: treated as recovery for the pool.
            poolAssets += amount;
            emit Recovered(seller, amount);
            return;
        }

        uint256 toPrincipal;
        uint256 toFee;
        if (a.status == Status.Active) {
            toPrincipal = _min(amount, a.principal - a.repaidPrincipal);
            toFee = _min(amount - toPrincipal, a.fee - a.repaidFee);
            a.repaidPrincipal += toPrincipal;
            a.repaidFee += toFee;
            outstandingPrincipal -= toPrincipal;
            poolAssets += toFee;
            if (a.repaidPrincipal == a.principal && a.repaidFee == a.fee) {
                a.status = Status.Repaid;
                emit AdvanceRepaid(seller);
            }
        }

        uint256 toSeller = amount - toPrincipal - toFee;
        emit Collected(seller, amount, toPrincipal, toFee, toSeller);
        if (toSeller > 0) token.safeTransfer(seller, toSeller);
    }

    /// @notice Writes off the unrepaid principal. The reserve absorbs the loss first.
    function flagDefault(address seller) external nonReentrant onlyUnderwriter {
        Advance storage a = advances[seller];
        if (a.status != Status.Active) revert NoActiveAdvance();

        uint256 loss = a.principal - a.repaidPrincipal;
        uint256 covered = _min(reserve, loss);
        a.status = Status.Defaulted;
        outstandingPrincipal -= loss;
        reserve -= covered;
        poolAssets = poolAssets + covered - loss;
        emit DefaultFlagged(seller, loss, covered);
    }

    // ----------------------------------------------------------------- views

    /// @notice Cash that LPs and new advances can use. Excludes the reserve.
    function idleCash() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        return bal > reserve ? bal - reserve : 0;
    }

    function owed(address seller) external view returns (uint256) {
        Advance storage a = advances[seller];
        if (a.status != Status.Active) return 0;
        return (a.principal - a.repaidPrincipal) + (a.fee - a.repaidFee);
    }

    function sharePrice() external view returns (uint256) {
        if (totalShares == 0) return 1e18;
        return (poolAssets * 1e18) / totalShares;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
