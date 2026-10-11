// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "../lib/forge-std/src/Script.sol";
import {console2} from "../lib/forge-std/src/console2.sol";
import {ERC20Mock} from "../lib/openzeppelin-contracts/contracts/mocks/token/ERC20Mock.sol";
import {SafePayEscrow} from "../src/SafePayEscrow.sol";

/// @title DeploySafePay
/// @notice Deploys a mock ERC-20 and SafePayEscrow to Monad testnet.
/// @dev Run with `forge script script/Deploy.s.sol:DeploySafePay --rpc-url "$RPC_URL" --broadcast`.
contract DeploySafePay is Script {
    uint256 private constant MONAD_TESTNET_CHAIN_ID = 10_143;

    error MissingRpcUrl();
    error InvalidResolverAddress();
    error WrongChain(uint256 actualChainId);

    /// @notice Deploys the test token and configures it as SafePayEscrow's only supported token.
    /// @dev `RESOLVER_ADDRESS` is validated and printed for use in agreements; the escrow stores a resolver per agreement.
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        string memory rpcUrl = vm.envString("RPC_URL");
        address resolverAddress = vm.envAddress("RESOLVER_ADDRESS");

        if (bytes(rpcUrl).length == 0) revert MissingRpcUrl();
        if (resolverAddress == address(0)) revert InvalidResolverAddress();
        if (block.chainid != MONAD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        vm.startBroadcast(privateKey);

        ERC20Mock mockToken = new ERC20Mock();
        address[] memory supportedTokens = new address[](1);
        supportedTokens[0] = address(mockToken);
        SafePayEscrow escrow = new SafePayEscrow(supportedTokens);

        vm.stopBroadcast();

        console2.log("Mock ERC20 (test-only):", address(mockToken));
        console2.log("SafePayEscrow:", address(escrow));
        console2.log("Resolver for agreement creation:", resolverAddress);
        console2.log("Deployed on Monad testnet, chain ID:", block.chainid);
    }
}