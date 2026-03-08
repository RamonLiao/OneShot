// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Vault.sol";

contract DeployVault is Script {
    function run() external {
        // 讀取 USDC_<CHAIN>_ADDRESS，fallback 到 USDC_TOKEN_ADDRESS
        string memory envKey = _usdcEnvKey();
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address trustedSigner = vm.envAddress("CRE_TRUSTED_SIGNER");
        address tokenAddress = vm.envAddress(envKey);

        vm.startBroadcast(deployerPk);
        Vault vault = new Vault(tokenAddress, operator, trustedSigner);
        vm.stopBroadcast();

        console.log("Vault deployed at:", address(vault));
        console.log("  token (%s):", envKey, tokenAddress);
        console.log("  operator:", operator);
        console.log("  trustedSigner:", trustedSigner);
        console.log("  chainId:", block.chainid);
    }

    function _usdcEnvKey() internal view returns (string memory) {
        uint256 chainId = block.chainid;
        if (chainId == 84532) return "USDC_BASE_ADDRESS";
        if (chainId == 421614) return "USDC_ARBITRUM_ADDRESS";
        if (chainId == 11155420) return "USDC_OPTIMISM_ADDRESS";
        if (chainId == 4801) return "USDC_WORLD_ADDRESS";
        return "USDC_TOKEN_ADDRESS"; // fallback
    }
}
