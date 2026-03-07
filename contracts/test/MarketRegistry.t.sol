// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MarketRegistry.sol";

contract MarketRegistryTest is Test {
    MarketRegistry registry;
    address admin = address(this);
    address trustedSigner = address(0xC8E);

    function setUp() public {
        registry = new MarketRegistry(admin, trustedSigner);
    }

    function test_createBinaryMarket() public {
        string[] memory options = new string[](2);
        options[0] = "Yes";
        options[1] = "No";

        uint256 marketId = registry.createMarket(
            "Will ETH hit 10k?", options,
            MarketRegistry.MarketType.Binary,
            block.timestamp + 1 days, 0, 0, ""
        );

        assertEq(marketId, 0);
    }

    function test_createMarket_emitsEvent() public {
        string[] memory options = new string[](2);
        options[0] = "Yes";
        options[1] = "No";

        vm.expectEmit(true, false, false, true);
        emit MarketRegistry.MarketCreated(0, MarketRegistry.MarketType.Binary, "Test?");

        registry.createMarket("Test?", options, MarketRegistry.MarketType.Binary,
            block.timestamp + 1 days, 0, 0, "");
    }

    function test_setResult_onlyAdminOrTrusted() public {
        string[] memory options = new string[](2);
        options[0] = "Yes";
        options[1] = "No";
        registry.createMarket("Test?", options, MarketRegistry.MarketType.Binary,
            block.timestamp + 1 days, 0, 0, "");

        registry.setResult(0, 1);

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        registry.setResult(0, 0);
    }

    function test_setResult_emitsMarketSettled() public {
        string[] memory options = new string[](2);
        options[0] = "Yes";
        options[1] = "No";
        registry.createMarket("Test?", options, MarketRegistry.MarketType.Binary,
            block.timestamp + 1 days, 0, 0, "");

        vm.expectEmit(true, false, false, true);
        emit MarketRegistry.MarketSettled(0, 1);
        registry.setResult(0, 1);
    }

    function test_markFullySettled_onlyTrustedSigner() public {
        string[] memory options = new string[](2);
        options[0] = "Yes";
        options[1] = "No";
        registry.createMarket("Test?", options, MarketRegistry.MarketType.Binary,
            block.timestamp + 1 days, 0, 0, "");
        registry.setResult(0, 1);

        vm.prank(trustedSigner);
        registry.markFullySettled(0);

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        registry.markFullySettled(0);
    }
}
