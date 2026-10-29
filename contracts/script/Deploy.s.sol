// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReceivableVault} from "../src/ReceivableVault.sol";

/// Deploys ReceivableVault. Same script for testnet and mainnet; only the env differs.
///
///   TOKEN=0x...        stablecoin the pool lends (USDC/USDT on the target chain)
///   OWNER=0x...        can pause and rotate the underwriter. Use a multisig on mainnet.
///   UNDERWRITER=0x...  hot key the API signs with (registerSeller / advance / flagDefault)
///   MAX_ADVANCE=...    optional, token base units, default 1000 * 1e6 (6-decimal token)
///
///   forge script script/Deploy.s.sol --rpc-url $RPC --private-key $DEPLOYER_KEY --broadcast
///   (add --verify with the chain's explorer settings to publish source)
contract Deploy is Script {
    function run() external returns (ReceivableVault vault) {
        address token = vm.envAddress("TOKEN");
        address owner = vm.envAddress("OWNER");
        address underwriter = vm.envAddress("UNDERWRITER");
        uint256 maxAdvance = vm.envOr("MAX_ADVANCE", uint256(1_000e6));

        require(token.code.length > 0, "TOKEN is not a contract on this chain");
        require(owner != address(0) && underwriter != address(0), "zero address");

        vm.startBroadcast();
        vault = new ReceivableVault(IERC20(token), owner, underwriter, maxAdvance);
        vm.stopBroadcast();

        console.log("chainid      ", block.chainid);
        console.log("ReceivableVault", address(vault));
        console.log("token        ", token);
        console.log("owner        ", owner);
        console.log("underwriter  ", underwriter);
        console.log("maxAdvance   ", maxAdvance);
    }
}
