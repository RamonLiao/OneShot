// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/BetIngress.sol";

contract BetIngressTest is Test {
    BetIngress ingress;
    address operator = address(0xABCD);

    function setUp() public {
        ingress = new BetIngress(operator);
    }

    function test_placeBet_emitsEvent() public {
        bytes32 userId = keccak256("user1");
        bytes32 cHash = keccak256("cipher1");

        vm.prank(operator);
        vm.expectEmit(true, true, false, true);
        emit BetIngress.BetPlaced(0, userId, cHash, 100, 1);
        ingress.placeBet(0, userId, cHash, 100, 1);
    }

    function test_placeBet_preventsDoubleBet() public {
        bytes32 userId = keccak256("user1");

        vm.startPrank(operator);
        ingress.placeBet(0, userId, keccak256("c1"), 100, 1);

        vm.expectRevert("already bet");
        ingress.placeBet(0, userId, keccak256("c2"), 200, 1);
        vm.stopPrank();
    }

    function test_placeBet_onlyOperator() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("only operator");
        ingress.placeBet(0, keccak256("u"), keccak256("c"), 100, 1);
    }

    function test_sameUserDifferentMarkets() public {
        bytes32 userId = keccak256("user1");
        vm.startPrank(operator);
        ingress.placeBet(0, userId, keccak256("c1"), 100, 1);
        ingress.placeBet(1, userId, keccak256("c2"), 200, 1);
        vm.stopPrank();

        assertTrue(ingress.hasBet(userId, 0));
        assertTrue(ingress.hasBet(userId, 1));
    }
}
