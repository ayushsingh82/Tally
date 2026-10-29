// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReceivableVault} from "../src/ReceivableVault.sol";
import {SellerCollector} from "../src/SellerCollector.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ReceivableVaultTest is Test {
    MockUSDC usdc;
    ReceivableVault vault;
    SellerCollector collector;

    address owner = makeAddr("owner");
    address underwriter = makeAddr("underwriter");
    address lp = makeAddr("lp");
    address lp2 = makeAddr("lp2");
    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");
    address rando = makeAddr("rando");

    uint256 constant U = 1e6;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new ReceivableVault(usdc, owner, underwriter, 1_000 * U);

        usdc.mint(lp, 10_000 * U);
        usdc.mint(lp2, 10_000 * U);
        usdc.mint(buyer, 10_000 * U);
        usdc.mint(owner, 1_000 * U);

        vm.prank(lp);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(lp2);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(owner);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(underwriter);
        collector = SellerCollector(vault.registerSeller(seller));
    }

    // ---------------------------------------------------------------- helpers

    function _deposit(address who, uint256 amt) internal {
        vm.prank(who);
        vault.deposit(amt);
    }

    function _advance(uint256 amt, uint256 fee) internal {
        vm.prank(underwriter);
        vault.advance(seller, amt, fee);
    }

    /// Simulates an HSP settlement: plain ERC20 transfer to pay_to, then anyone sweeps.
    function _pay(uint256 amt) internal {
        vm.prank(buyer);
        usdc.transfer(address(collector), amt);
        collector.sweep();
    }

    function _status(address s) internal view returns (ReceivableVault.Status st) {
        (,,,, st) = vault.advances(s);
    }

    // --------------------------------------------------------------------- LPs

    function test_depositFirstMintsOneToOne() public {
        _deposit(lp, 1_000 * U);
        assertEq(vault.shares(lp), 1_000 * U);
        assertEq(vault.poolAssets(), 1_000 * U);
        assertEq(vault.sharePrice(), 1e18);
    }

    function test_withdrawReturnsDeposit() public {
        _deposit(lp, 1_000 * U);
        vm.prank(lp);
        vault.withdraw(1_000 * U);
        assertEq(usdc.balanceOf(lp), 10_000 * U);
        assertEq(vault.totalShares(), 0);
    }

    function test_withdrawLimitedByIdleCash() public {
        _deposit(lp, 1_000 * U);
        _advance(800 * U, 80 * U);
        vm.prank(lp);
        vm.expectRevert(ReceivableVault.InsufficientIdleCash.selector);
        vault.withdraw(1_000 * U);
    }

    function test_withdrawMoreThanSharesReverts() public {
        _deposit(lp, 100 * U);
        vm.prank(lp);
        vm.expectRevert(ReceivableVault.InsufficientShares.selector);
        vault.withdraw(101 * U);
    }

    function test_zeroDepositReverts() public {
        vm.prank(lp);
        vm.expectRevert(ReceivableVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    // ---------------------------------------------------------------- sellers

    function test_registerSellerOnlyUnderwriter() public {
        vm.prank(rando);
        vm.expectRevert(ReceivableVault.NotUnderwriter.selector);
        vault.registerSeller(rando);
    }

    function test_registerSellerTwiceReverts() public {
        vm.prank(underwriter);
        vm.expectRevert(ReceivableVault.SellerAlreadyRegistered.selector);
        vault.registerSeller(seller);
    }

    function test_collectorWiring() public view {
        assertEq(vault.collectorOf(seller), address(collector));
        assertEq(address(collector.vault()), address(vault));
        assertEq(collector.seller(), seller);
    }

    // ---------------------------------------------------------------- advance

    function test_advanceHappyPath() public {
        _deposit(lp, 1_000 * U);
        _advance(120 * U, 12 * U);

        assertEq(usdc.balanceOf(seller), 120 * U);
        assertEq(vault.idleCash(), 880 * U);
        assertEq(vault.poolAssets(), 1_000 * U, "advance does not change LP value");
        assertEq(vault.outstandingPrincipal(), 120 * U);
        assertEq(vault.owed(seller), 132 * U);
        assertTrue(_status(seller) == ReceivableVault.Status.Active);
    }

    function test_advanceOnlyUnderwriter() public {
        _deposit(lp, 1_000 * U);
        vm.prank(rando);
        vm.expectRevert(ReceivableVault.NotUnderwriter.selector);
        vault.advance(seller, 100 * U, 10 * U);
    }

    function test_advanceUnregisteredSellerReverts() public {
        _deposit(lp, 1_000 * U);
        vm.prank(underwriter);
        vm.expectRevert(ReceivableVault.SellerNotRegistered.selector);
        vault.advance(rando, 100 * U, 10 * U);
    }

    function test_advanceExceedsMaxReverts() public {
        _deposit(lp, 5_000 * U);
        vm.prank(underwriter);
        vm.expectRevert(ReceivableVault.ExceedsMaxAdvance.selector);
        vault.advance(seller, 1_001 * U, 10 * U);
    }

    function test_advanceExceedsIdleReverts() public {
        _deposit(lp, 100 * U);
        vm.prank(underwriter);
        vm.expectRevert(ReceivableVault.InsufficientIdleCash.selector);
        vault.advance(seller, 101 * U, 10 * U);
    }

    function test_advanceCannotUseReserve() public {
        _deposit(lp, 100 * U);
        vm.prank(owner);
        vault.fundReserve(500 * U);
        vm.prank(underwriter);
        vm.expectRevert(ReceivableVault.InsufficientIdleCash.selector);
        vault.advance(seller, 101 * U, 10 * U);
    }

    function test_advanceInvalidFeeReverts() public {
        _deposit(lp, 1_000 * U);
        vm.startPrank(underwriter);
        vm.expectRevert(ReceivableVault.InvalidFee.selector);
        vault.advance(seller, 100 * U, 0);
        vm.expectRevert(ReceivableVault.InvalidFee.selector);
        vault.advance(seller, 100 * U, 101 * U);
        vm.stopPrank();
    }

    function test_secondActiveAdvanceReverts() public {
        _deposit(lp, 1_000 * U);
        _advance(100 * U, 10 * U);
        vm.prank(underwriter);
        vm.expectRevert(ReceivableVault.AdvanceExists.selector);
        vault.advance(seller, 100 * U, 10 * U);
    }

    function test_advanceWhenPausedReverts() public {
        _deposit(lp, 1_000 * U);
        vm.prank(owner);
        vault.pause();
        vm.prank(underwriter);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.advance(seller, 100 * U, 10 * U);
    }

    // -------------------------------------------------------------- waterfall

    function test_partialPaymentGoesToPrincipalFirst() public {
        _deposit(lp, 1_000 * U);
        _advance(120 * U, 12 * U);

        _pay(50 * U);

        (uint256 p, uint256 f, uint256 rp, uint256 rf,) = vault.advances(seller);
        assertEq(p, 120 * U);
        assertEq(f, 12 * U);
        assertEq(rp, 50 * U);
        assertEq(rf, 0);
        assertEq(usdc.balanceOf(seller), 120 * U, "seller gets nothing yet");
        assertEq(vault.outstandingPrincipal(), 70 * U);
        assertEq(vault.owed(seller), 82 * U);
        assertTrue(_status(seller) == ReceivableVault.Status.Active);
    }

    function test_feeRepaidAfterPrincipal() public {
        _deposit(lp, 1_000 * U);
        _advance(120 * U, 12 * U);

        _pay(125 * U);

        (,, uint256 rp, uint256 rf,) = vault.advances(seller);
        assertEq(rp, 120 * U);
        assertEq(rf, 5 * U);
        assertEq(vault.poolAssets(), 1_005 * U);
    }

    function test_fullRepaymentWithSurplusToSeller() public {
        _deposit(lp, 1_000 * U);
        _advance(120 * U, 12 * U);

        _pay(180 * U);

        assertTrue(_status(seller) == ReceivableVault.Status.Repaid);
        assertEq(vault.poolAssets(), 1_012 * U, "LPs earned the fee");
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(usdc.balanceOf(seller), 120 * U + 48 * U, "surplus 180 - 132 forwarded");
        assertEq(usdc.balanceOf(address(vault)), 1_012 * U);
    }

    function test_paymentAfterRepaidGoesToSeller() public {
        _deposit(lp, 1_000 * U);
        _advance(100 * U, 10 * U);
        _pay(110 * U);
        uint256 before_ = usdc.balanceOf(seller);

        _pay(40 * U);

        assertEq(usdc.balanceOf(seller), before_ + 40 * U);
        assertEq(vault.poolAssets(), 1_010 * U);
    }

    function test_paymentWithNoAdvanceGoesToSeller() public {
        _pay(30 * U);
        assertEq(usdc.balanceOf(seller), 30 * U);
    }

    function test_lpWithdrawsWithYield() public {
        _deposit(lp, 1_000 * U);
        _advance(100 * U, 10 * U);
        _pay(110 * U);

        vm.prank(lp);
        vault.withdraw(1_000 * U);
        assertEq(usdc.balanceOf(lp), 10_000 * U + 10 * U);
    }

    function test_yieldSharedProRataBetweenLPs() public {
        _deposit(lp, 1_000 * U);
        _deposit(lp2, 3_000 * U);
        _advance(100 * U, 40 * U);
        _pay(140 * U);

        vm.prank(lp);
        uint256 a = vault.withdraw(1_000 * U);
        vm.prank(lp2);
        uint256 b = vault.withdraw(3_000 * U);
        assertEq(a, 1_010 * U);
        assertEq(b, 3_030 * U);
    }

    function test_laterDepositorDoesNotStealEarlierYield() public {
        _deposit(lp, 1_000 * U);
        _advance(100 * U, 10 * U);
        _pay(110 * U); // poolAssets 1010
        _deposit(lp2, 1_010 * U); // gets shares at the post-yield price

        assertEq(vault.shares(lp2), 1_000 * U);
        vm.prank(lp);
        assertEq(vault.withdraw(1_000 * U), 1_010 * U);
    }

    function test_recordCollectionOnlyFromCollector() public {
        vm.prank(rando);
        vm.expectRevert(ReceivableVault.NotCollector.selector);
        vault.recordCollection(seller, 1);
    }

    function test_sweepWithNothingReverts() public {
        vm.expectRevert(SellerCollector.NothingToSweep.selector);
        collector.sweep();
    }

    function test_repaymentsStillWorkWhenPaused() public {
        _deposit(lp, 1_000 * U);
        _advance(100 * U, 10 * U);
        vm.prank(owner);
        vault.pause();
        _pay(110 * U);
        assertTrue(_status(seller) == ReceivableVault.Status.Repaid);
    }

    // ---------------------------------------------------------------- default

    function test_defaultCoveredFullyByReserve() public {
        _deposit(lp, 1_000 * U);
        vm.prank(owner);
        vault.fundReserve(200 * U);
        _advance(120 * U, 12 * U);
        _pay(20 * U); // 100 principal unrepaid

        vm.prank(underwriter);
        vault.flagDefault(seller);

        assertTrue(_status(seller) == ReceivableVault.Status.Defaulted);
        assertEq(vault.reserve(), 100 * U);
        assertEq(vault.poolAssets(), 1_000 * U, "LPs unharmed");
        assertEq(vault.outstandingPrincipal(), 0);
    }

    function test_defaultPartiallyCoveredByReserve() public {
        _deposit(lp, 1_000 * U);
        vm.prank(owner);
        vault.fundReserve(30 * U);
        _advance(120 * U, 12 * U);

        vm.prank(underwriter);
        vault.flagDefault(seller);

        assertEq(vault.reserve(), 0);
        assertEq(vault.poolAssets(), 910 * U, "LP absorbs 120 - 30");
    }

    function test_defaultWithNoReserveHitsLPs() public {
        _deposit(lp, 1_000 * U);
        _advance(120 * U, 12 * U);
        vm.prank(underwriter);
        vault.flagDefault(seller);
        assertEq(vault.poolAssets(), 880 * U);
        assertLt(vault.sharePrice(), 1e18);
    }

    function test_defaultOnlyUnderwriterAndOnlyActive() public {
        _deposit(lp, 1_000 * U);
        vm.prank(underwriter);
        vm.expectRevert(ReceivableVault.NoActiveAdvance.selector);
        vault.flagDefault(seller);

        _advance(100 * U, 10 * U);
        vm.prank(rando);
        vm.expectRevert(ReceivableVault.NotUnderwriter.selector);
        vault.flagDefault(seller);
    }

    function test_paymentAfterDefaultIsRecoveryForPool() public {
        _deposit(lp, 1_000 * U);
        _advance(120 * U, 12 * U);
        vm.prank(underwriter);
        vault.flagDefault(seller);

        _pay(50 * U);

        assertEq(vault.poolAssets(), 930 * U);
        assertEq(usdc.balanceOf(seller), 120 * U, "seller gets nothing after default");
    }

    function test_newAdvanceAllowedAfterRepaid() public {
        _deposit(lp, 1_000 * U);
        _advance(100 * U, 10 * U);
        _pay(110 * U);
        _advance(200 * U, 20 * U);
        assertEq(vault.owed(seller), 220 * U);
    }

    // ------------------------------------------------------------------ admin

    function test_adminOnlyOwner() public {
        vm.startPrank(rando);
        vm.expectRevert();
        vault.setUnderwriter(rando);
        vm.expectRevert();
        vault.setMaxAdvance(1);
        vm.expectRevert();
        vault.pause();
        vm.stopPrank();
    }

    function test_ownerCanRotateUnderwriter() public {
        vm.prank(owner);
        vault.setUnderwriter(rando);
        vm.prank(underwriter);
        vm.expectRevert(ReceivableVault.NotUnderwriter.selector);
        vault.registerSeller(rando);
    }

    // ------------------------------------------------------------------- fuzz

    /// Every token paid in must end up either in the vault accounting or with the seller.
    function testFuzz_waterfallConservesTokens(uint96 principal, uint96 fee, uint96 payment) public {
        principal = uint96(bound(principal, 1, 1_000 * U));
        fee = uint96(bound(fee, 1, principal));
        payment = uint96(bound(payment, 1, 5_000 * U));

        _deposit(lp, 5_000 * U);
        _advance(principal, fee);
        uint256 vaultBefore = usdc.balanceOf(address(vault));
        uint256 sellerBefore = usdc.balanceOf(seller);

        _pay(payment);

        uint256 vaultGain = usdc.balanceOf(address(vault)) - vaultBefore;
        uint256 sellerGain = usdc.balanceOf(seller) - sellerBefore;
        assertEq(vaultGain + sellerGain, payment, "no tokens created or lost");
        assertLe(vaultGain, uint256(principal) + fee, "pool never collects more than owed");
        assertEq(usdc.balanceOf(address(collector)), 0);
    }

    /// poolAssets plus reserve never exceeds the token balance plus outstanding principal.
    function testFuzz_solvencyInvariant(uint96 principal, uint96 fee, uint96 payment, bool doDefault) public {
        principal = uint96(bound(principal, 1, 1_000 * U));
        fee = uint96(bound(fee, 1, principal));
        payment = uint96(bound(payment, 1, 2_000 * U));

        _deposit(lp, 5_000 * U);
        vm.prank(owner);
        vault.fundReserve(100 * U);
        _advance(principal, fee);
        _pay(payment);
        if (doDefault && _status(seller) == ReceivableVault.Status.Active) {
            vm.prank(underwriter);
            vault.flagDefault(seller);
        }

        assertEq(
            vault.poolAssets() + vault.reserve(),
            usdc.balanceOf(address(vault)) + vault.outstandingPrincipal(),
            "accounting matches reality"
        );
    }
}
