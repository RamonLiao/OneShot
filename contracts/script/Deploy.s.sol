// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MarketRegistry.sol";
import "../src/BetIngress.sol";
import "../src/Vault.sol";

contract DeployBaseSepolia is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address trustedSigner = vm.envAddress("CRE_TRUSTED_SIGNER");
        address tokenAddress = vm.envAddress("USDC_TOKEN_ADDRESS");

        vm.startBroadcast(deployerPk);
        MarketRegistry registry = new MarketRegistry(msg.sender, trustedSigner);
        BetIngress ingress = new BetIngress(operator);
        Vault vault = new Vault(tokenAddress, operator, trustedSigner);
        vm.stopBroadcast();

        console.log("MarketRegistry:", address(registry));
        console.log("BetIngress:", address(ingress));
        console.log("Vault:", address(vault));
    }
}
