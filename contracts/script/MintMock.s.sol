// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "../lib/forge-std/src/Script.sol";
import {console2} from "../lib/forge-std/src/console2.sol";
import {ERC20Mock} from "../lib/openzeppelin-contracts/contracts/mocks/token/ERC20Mock.sol";

/// @title MintMockTokens
/// @notice Mints 1,000,000 test ERC-20 tokens to a selected Monad testnet client.
/// @dev Run with `forge script script/MintMock.s.sol:MintMockTokens --rpc-url "$RPC_URL" --broadcast`.
contract MintMockTokens is Script {
    uint256 private constant MONAD_TESTNET_CHAIN_ID = 10_143;
    uint256 public constant MINT_AMOUNT = 1_000_000 ether;

    error MissingRpcUrl();
    error InvalidClientAddress();
    error InvalidMockToken(address token);
    error WrongChain(uint256 actualChainId);

    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        string memory rpcUrl = vm.envString("RPC_URL");
        address clientAddress = vm.envAddress("CLIENT_ADDRESS");
        address mockTokenAddress = vm.envAddress("MOCK_TOKEN_ADDRESS");

        if (bytes(rpcUrl).length == 0) revert MissingRpcUrl();
        if (clientAddress == address(0)) revert InvalidClientAddress();
        if (block.chainid != MONAD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (mockTokenAddress == address(0) || mockTokenAddress.code.length == 0) {
            revert InvalidMockToken(mockTokenAddress);
        }

        ERC20Mock mockToken = ERC20Mock(mockTokenAddress);
        if (
            mockToken.decimals() != 18 || keccak256(bytes(mockToken.name())) != keccak256("ERC20Mock")
                || keccak256(bytes(mockToken.symbol())) != keccak256("E20M")
        ) revert InvalidMockToken(mockTokenAddress);

        vm.startBroadcast(privateKey);
        mockToken.mint(clientAddress, MINT_AMOUNT);
        vm.stopBroadcast();

        console2.log("Minted 1,000,000 E20M to:", clientAddress);
        console2.log("Mock token:", mockTokenAddress);
        console2.log("Minted base units:", MINT_AMOUNT);
        console2.log("Monad testnet chain ID:", block.chainid);
    }
}
