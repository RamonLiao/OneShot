// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Vault.sol";
import "../src/mocks/MockERC20.sol";

contract VaultTest is Test {
    Vault vault;
    MockERC20 token;
    address operator;
    uint256 operatorPk = 0x0BE7;
    address trustedSigner;
    uint256 trustedSignerPk = 0xA11CE;
    address user = address(0x1234);
    bytes32 hashedUserId = keccak256("user1");

    function setUp() public {
        operator = vm.addr(operatorPk);
        trustedSigner = vm.addr(trustedSignerPk);
        token = new MockERC20();
        vault = new Vault(address(token), operator, trustedSigner);
        token.mint(user, 10_000e6);
        token.mint(address(vault), 100_000e6);
    }

    function test_deposit() public {
        vm.startPrank(user);
        token.approve(address(vault), 1000e6);
        vault.deposit(hashedUserId, 1000e6);
        vm.stopPrank();
        assertEq(vault.deposits(hashedUserId), 1000e6);
        assertEq(vault.available(hashedUserId), 1000e6);
    }

    function test_allocate() public {
        vm.startPrank(user);
        token.approve(address(vault), 1000e6);
        vault.deposit(hashedUserId, 1000e6);
        vm.stopPrank();

        vm.prank(operator);
        vault.allocate(hashedUserId, 500e6);
        assertEq(vault.available(hashedUserId), 500e6);
    }

    function test_allocate_insufficient() public {
        vm.startPrank(user);
        token.approve(address(vault), 100e6);
        vault.deposit(hashedUserId, 100e6);
        vm.stopPrank();

        vm.prank(operator);
        vm.expectRevert("insufficient");
        vault.allocate(hashedUserId, 200e6);
    }

    function test_recordPayout_validSignature() public {
        uint256 marketId = 0;
        uint256 amount = 500e6;

        bytes32 msgHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustedSignerPk, ethHash);

        vault.recordPayout(hashedUserId, marketId, amount, abi.encodePacked(r, s, v));
        assertEq(vault.claimable(hashedUserId, marketId), amount);
    }

    function test_recordPayout_invalidSignature() public {
        uint256 fakePk = 0xDEAD;
        bytes32 msgHash = keccak256(abi.encodePacked(
            hashedUserId, uint256(0), uint256(500e6), block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakePk, ethHash);

        vm.expectRevert("invalid CRE signature");
        vault.recordPayout(hashedUserId, 0, 500e6, abi.encodePacked(r, s, v));
    }

    function test_claim_fullFlow() public {
        uint256 marketId = 0;
        uint256 amount = 500e6;

        // Record payout
        bytes32 msgHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustedSignerPk, ethHash);
        vault.recordPayout(hashedUserId, marketId, amount, abi.encodePacked(r, s, v));

        // Claim
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 claimHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, deadline, block.chainid, address(vault)
        ));
        bytes32 ethClaimHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", claimHash
        ));
        (v, r, s) = vm.sign(operatorPk, ethClaimHash);

        uint256 before = token.balanceOf(user);
        vm.prank(user);
        vault.claim(hashedUserId, marketId, amount, deadline, abi.encodePacked(r, s, v));
        assertEq(token.balanceOf(user) - before, amount);
        assertTrue(vault.claimed(hashedUserId, marketId));
    }

    function test_claim_doubleClaim() public {
        uint256 marketId = 0;
        uint256 amount = 500e6;

        // Record payout
        bytes32 msgHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustedSignerPk, ethHash);
        vault.recordPayout(hashedUserId, marketId, amount, abi.encodePacked(r, s, v));

        // First claim
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 claimHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, deadline, block.chainid, address(vault)
        ));
        bytes32 ethClaimHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", claimHash
        ));
        (v, r, s) = vm.sign(operatorPk, ethClaimHash);

        vm.prank(user);
        vault.claim(hashedUserId, marketId, amount, deadline, abi.encodePacked(r, s, v));

        // Second claim should fail
        vm.prank(user);
        vm.expectRevert("already claimed");
        vault.claim(hashedUserId, marketId, amount, deadline, abi.encodePacked(r, s, v));
    }
}
