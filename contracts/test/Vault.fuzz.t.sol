// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Vault.sol";
import "../src/mocks/MockERC20.sol";

contract VaultFuzzTest is Test {
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
        token.mint(user, type(uint96).max);
        token.mint(address(vault), type(uint96).max);
    }

    // --- Helpers ---

    function _signPayout(bytes32 _userId, uint256 marketId, uint256 amount)
        internal view returns (bytes memory)
    {
        bytes32 msgHash = keccak256(abi.encodePacked(
            _userId, marketId, amount, block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustedSignerPk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _signClaim(bytes32 _userId, uint256 marketId, uint256 amount, uint256 deadline)
        internal view returns (bytes memory)
    {
        bytes32 claimHash = keccak256(abi.encodePacked(
            _userId, marketId, amount, deadline, block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", claimHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(operatorPk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    // --- Fuzz Tests ---

    function testFuzz_deposit(uint256 amount) public {
        amount = bound(amount, 1, type(uint96).max);

        vm.startPrank(user);
        token.approve(address(vault), amount);
        vault.deposit(hashedUserId, amount);
        vm.stopPrank();

        assertEq(vault.deposits(hashedUserId), amount);
        assertEq(vault.available(hashedUserId), amount);
    }

    function testFuzz_allocate(uint256 depositAmt, uint256 allocateAmt) public {
        depositAmt = bound(depositAmt, 1, type(uint96).max);
        allocateAmt = bound(allocateAmt, 1, type(uint96).max);

        vm.startPrank(user);
        token.approve(address(vault), depositAmt);
        vault.deposit(hashedUserId, depositAmt);
        vm.stopPrank();

        if (allocateAmt > depositAmt) {
            vm.prank(operator);
            vm.expectRevert("insufficient");
            vault.allocate(hashedUserId, allocateAmt);
        } else {
            vm.prank(operator);
            vault.allocate(hashedUserId, allocateAmt);
            assertEq(vault.available(hashedUserId), depositAmt - allocateAmt);
        }
    }

    function testFuzz_recordPayout(uint256 amount, uint256 marketId) public {
        amount = bound(amount, 0, type(uint96).max);
        marketId = bound(marketId, 0, 1000);

        bytes memory sig = _signPayout(hashedUserId, marketId, amount);
        vault.recordPayout(hashedUserId, marketId, amount, sig);
        assertEq(vault.claimable(hashedUserId, marketId), amount);
    }

    function testFuzz_claim(uint256 amount, uint256 deadline) public {
        amount = bound(amount, 1, type(uint96).max);

        uint256 marketId = 0;

        // Record payout
        vault.recordPayout(hashedUserId, marketId, amount, _signPayout(hashedUserId, marketId, amount));

        if (deadline < block.timestamp) {
            bytes memory claimSig = _signClaim(hashedUserId, marketId, amount, deadline);
            vm.prank(user);
            vm.expectRevert("expired");
            vault.claim(hashedUserId, marketId, amount, deadline, claimSig);
        } else {
            bytes memory claimSig = _signClaim(hashedUserId, marketId, amount, deadline);
            uint256 before = token.balanceOf(user);
            vm.prank(user);
            vault.claim(hashedUserId, marketId, amount, deadline, claimSig);
            assertEq(token.balanceOf(user) - before, amount);
            assertTrue(vault.claimed(hashedUserId, marketId));
        }
    }

    function testFuzz_multipleDeposits(uint256 amt1, uint256 amt2) public {
        amt1 = bound(amt1, 1, type(uint96).max / 2);
        amt2 = bound(amt2, 1, type(uint96).max / 2);

        vm.startPrank(user);
        token.approve(address(vault), amt1 + amt2);
        vault.deposit(hashedUserId, amt1);
        vault.deposit(hashedUserId, amt2);
        vm.stopPrank();

        assertEq(vault.deposits(hashedUserId), amt1 + amt2);
        assertEq(vault.available(hashedUserId), amt1 + amt2);
    }

    function testFuzz_depositDifferentUsers(
        bytes32 user1, bytes32 user2, uint256 amt1, uint256 amt2
    ) public {
        vm.assume(user1 != user2);
        amt1 = bound(amt1, 1, type(uint96).max / 2);
        amt2 = bound(amt2, 1, type(uint96).max / 2);

        vm.startPrank(user);
        token.approve(address(vault), amt1 + amt2);
        vault.deposit(user1, amt1);
        vault.deposit(user2, amt2);
        vm.stopPrank();

        assertEq(vault.deposits(user1), amt1);
        assertEq(vault.deposits(user2), amt2);
        assertEq(vault.available(user1), amt1);
        assertEq(vault.available(user2), amt2);
    }

    // --- Monkey Tests (extreme edge cases) ---

    function test_depositZero() public {
        vm.prank(user);
        vm.expectRevert("amount must be > 0");
        vault.deposit(hashedUserId, 0);
    }

    function test_depositMaxUint() public {
        vm.startPrank(user);
        token.approve(address(vault), type(uint256).max);
        // user only has type(uint96).max tokens, so max uint256 should revert
        vm.expectRevert();
        vault.deposit(hashedUserId, type(uint256).max);
        vm.stopPrank();
    }

    function test_allocateMoreThanDeposited_extreme() public {
        vm.startPrank(user);
        token.approve(address(vault), 1);
        vault.deposit(hashedUserId, 1);
        vm.stopPrank();

        vm.prank(operator);
        vm.expectRevert("insufficient");
        vault.allocate(hashedUserId, type(uint256).max);
    }

    function test_claimExpiredDeadline() public {
        uint256 marketId = 0;
        uint256 amount = 500e6;

        vault.recordPayout(hashedUserId, marketId, amount, _signPayout(hashedUserId, marketId, amount));

        uint256 deadline = 0;
        bytes memory claimSig = _signClaim(hashedUserId, marketId, amount, deadline);

        vm.prank(user);
        vm.expectRevert("expired");
        vault.claim(hashedUserId, marketId, amount, deadline, claimSig);
    }

    function test_claimWrongAmount() public {
        uint256 marketId = 0;
        uint256 recordedAmount = 500e6;
        uint256 claimAmount = 600e6;

        vault.recordPayout(hashedUserId, marketId, recordedAmount, _signPayout(hashedUserId, marketId, recordedAmount));

        uint256 deadline = block.timestamp + 1 hours;
        // Sign with wrong amount — signature will be for 600e6 but claimable is 500e6
        bytes memory claimSig = _signClaim(hashedUserId, marketId, claimAmount, deadline);

        vm.prank(user);
        vm.expectRevert("amount mismatch");
        vault.claim(hashedUserId, marketId, claimAmount, deadline, claimSig);
    }

    function test_recordPayoutOverwrite() public {
        uint256 marketId = 0;

        // First record: 500
        vault.recordPayout(hashedUserId, marketId, 500e6, _signPayout(hashedUserId, marketId, 500e6));
        assertEq(vault.claimable(hashedUserId, marketId), 500e6);

        // Second record: 800 — should overwrite
        vault.recordPayout(hashedUserId, marketId, 800e6, _signPayout(hashedUserId, marketId, 800e6));
        assertEq(vault.claimable(hashedUserId, marketId), 800e6);
    }

    function test_signatureReplay_differentChain() public {
        uint256 marketId = 0;
        uint256 amount = 500e6;

        // Generate sig on current chain
        bytes memory sig = _signPayout(hashedUserId, marketId, amount);

        // Switch to different chainId
        vm.chainId(999);

        // Sig should now be invalid since chainId changed
        vm.expectRevert("invalid CRE signature");
        vault.recordPayout(hashedUserId, marketId, amount, sig);
    }

    function test_allocateWithoutDeposit() public {
        bytes32 noDeposit = keccak256("ghost");
        vm.prank(operator);
        vm.expectRevert(); // underflow in available()
        vault.allocate(noDeposit, 1);
    }

    function test_claimZeroAmount() public {
        uint256 marketId = 0;
        // Record payout of 0
        vault.recordPayout(hashedUserId, marketId, 0, _signPayout(hashedUserId, marketId, 0));

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory claimSig = _signClaim(hashedUserId, marketId, 0, deadline);

        vm.prank(user);
        vault.claim(hashedUserId, marketId, 0, deadline, claimSig);
        assertTrue(vault.claimed(hashedUserId, marketId));
    }

    function test_nonOperatorAllocate() public {
        vm.startPrank(user);
        token.approve(address(vault), 1000e6);
        vault.deposit(hashedUserId, 1000e6);
        vm.expectRevert("only operator");
        vault.allocate(hashedUserId, 500e6);
        vm.stopPrank();
    }
}
