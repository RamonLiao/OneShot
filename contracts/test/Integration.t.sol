// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MarketRegistry.sol";
import "../src/BetIngress.sol";
import "../src/Vault.sol";
import "../src/mocks/MockERC20.sol";

contract IntegrationTest is Test {
    MarketRegistry registry;
    BetIngress ingress;
    Vault vault;
    MockERC20 token;

    address admin;
    uint256 adminPk = 0xAD;
    address operator;
    uint256 operatorPk = 0x0BE7;
    address trustedSigner;
    uint256 trustedSignerPk = 0xA11CE;

    address userA = address(0xA);
    address userB = address(0xB);
    address userC = address(0xC);

    bytes32 userIdA = keccak256("userA");
    bytes32 userIdB = keccak256("userB");
    bytes32 userIdC = keccak256("userC");

    function setUp() public {
        admin = vm.addr(adminPk);
        operator = vm.addr(operatorPk);
        trustedSigner = vm.addr(trustedSignerPk);

        token = new MockERC20();
        registry = new MarketRegistry(admin, trustedSigner);
        ingress = new BetIngress(operator);
        vault = new Vault(address(token), operator, trustedSigner);

        token.mint(userA, 100_000e6);
        token.mint(userB, 100_000e6);
        token.mint(userC, 100_000e6);
        token.mint(address(vault), 1_000_000e6);
    }

    // --- Helpers ---

    function _signPayout(bytes32 userId, uint256 marketId, uint256 amount)
        internal view returns (bytes memory)
    {
        bytes32 msgHash = keccak256(abi.encodePacked(
            userId, marketId, amount, block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustedSignerPk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _signClaim(bytes32 userId, uint256 marketId, uint256 amount, uint256 deadline)
        internal view returns (bytes memory)
    {
        bytes32 claimHash = keccak256(abi.encodePacked(
            userId, marketId, amount, deadline, block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", claimHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(operatorPk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _createBinaryMarket(string memory question) internal returns (uint256) {
        string[] memory opts = new string[](2);
        opts[0] = "Yes";
        opts[1] = "No";
        vm.prank(admin);
        return registry.createMarket(question, opts, MarketRegistry.MarketType.Binary, block.timestamp + 1 days, 0, 0, "");
    }

    function _depositAndAllocate(address usr, bytes32 userId, uint256 depositAmt, uint256 allocateAmt) internal {
        vm.startPrank(usr);
        token.approve(address(vault), depositAmt);
        vault.deposit(userId, depositAmt);
        vm.stopPrank();

        vm.prank(operator);
        vault.allocate(userId, allocateAmt);
    }

    function _placeBet(uint256 marketId, bytes32 userId, uint256 amount) internal {
        vm.prank(operator);
        ingress.placeBet(marketId, userId, keccak256("cipher"), amount, 1);
    }

    function _recordAndClaim(address usr, bytes32 userId, uint256 marketId, uint256 amount) internal {
        vault.recordPayout(userId, marketId, amount, _signPayout(userId, marketId, amount));

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory claimSig = _signClaim(userId, marketId, amount, deadline);

        vm.prank(usr);
        vault.claim(userId, marketId, amount, deadline, claimSig);
    }

    // --- Integration Tests ---

    function test_fullFlow_binaryMarket() public {
        // 1. Create market
        uint256 marketId = _createBinaryMarket("Will ETH > 5000?");

        // 2. Deposit + allocate
        _depositAndAllocate(userA, userIdA, 1000e6, 500e6);

        // 3. Place bet
        _placeBet(marketId, userIdA, 500e6);

        // 4. Set result
        vm.prank(admin);
        registry.setResult(marketId, 1); // Yes wins

        // 5. Record payout + claim
        uint256 payout = 900e6;
        _recordAndClaim(userA, userIdA, marketId, payout);

        assertTrue(vault.claimed(userIdA, marketId));
    }

    function test_fullFlow_categoricalMarket() public {
        // Create categorical market with 4 options
        string[] memory opts = new string[](4);
        opts[0] = "Red";
        opts[1] = "Blue";
        opts[2] = "Green";
        opts[3] = "Yellow";
        vm.prank(admin);
        uint256 marketId = registry.createMarket(
            "Which color?", opts, MarketRegistry.MarketType.Categorical,
            block.timestamp + 1 days, 0, 0, ""
        );

        _depositAndAllocate(userA, userIdA, 2000e6, 1000e6);
        _placeBet(marketId, userIdA, 1000e6);

        vm.prank(admin);
        registry.setResult(marketId, 2); // Green wins

        _recordAndClaim(userA, userIdA, marketId, 3000e6);

        assertTrue(vault.claimed(userIdA, marketId));
    }

    function test_fullFlow_scalarMarket() public {
        // Create scalar market
        string[] memory opts = new string[](0);
        vm.prank(admin);
        uint256 marketId = registry.createMarket(
            "ETH price on Jan 1?", opts, MarketRegistry.MarketType.Scalar,
            block.timestamp + 1 days, 1000, 10000, "https://api.example.com"
        );

        _depositAndAllocate(userA, userIdA, 5000e6, 2000e6);
        _placeBet(marketId, userIdA, 2000e6);

        vm.prank(admin);
        registry.setResult(marketId, 5500);

        _recordAndClaim(userA, userIdA, marketId, 3500e6);

        assertTrue(vault.claimed(userIdA, marketId));
    }

    function test_multipleUsersSameMarket() public {
        uint256 marketId = _createBinaryMarket("Will BTC > 100k?");

        // 3 users deposit, allocate, bet
        _depositAndAllocate(userA, userIdA, 1000e6, 1000e6);
        _depositAndAllocate(userB, userIdB, 2000e6, 2000e6);
        _depositAndAllocate(userC, userIdC, 3000e6, 3000e6);

        _placeBet(marketId, userIdA, 1000e6);
        _placeBet(marketId, userIdB, 2000e6);
        _placeBet(marketId, userIdC, 3000e6);

        // Settle
        vm.prank(admin);
        registry.setResult(marketId, 1);

        // Each user claims different payout
        uint256 balA = token.balanceOf(userA);
        uint256 balB = token.balanceOf(userB);
        uint256 balC = token.balanceOf(userC);

        _recordAndClaim(userA, userIdA, marketId, 1800e6);
        _recordAndClaim(userB, userIdB, marketId, 3600e6);
        _recordAndClaim(userC, userIdC, marketId, 500e6);

        assertEq(token.balanceOf(userA) - balA, 1800e6);
        assertEq(token.balanceOf(userB) - balB, 3600e6);
        assertEq(token.balanceOf(userC) - balC, 500e6);

        assertTrue(vault.claimed(userIdA, marketId));
        assertTrue(vault.claimed(userIdB, marketId));
        assertTrue(vault.claimed(userIdC, marketId));
    }

    function test_claimBeforeSettle() public {
        uint256 marketId = _createBinaryMarket("Will SOL > 200?");

        _depositAndAllocate(userA, userIdA, 1000e6, 500e6);
        _placeBet(marketId, userIdA, 500e6);

        // No payout recorded — claimable is 0, so claiming any amount should revert
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory claimSig = _signClaim(userIdA, marketId, 500e6, deadline);

        vm.prank(userA);
        vm.expectRevert("amount mismatch");
        vault.claim(userIdA, marketId, 500e6, deadline, claimSig);
    }

    function test_doubleClaimDifferentMarkets() public {
        uint256 market0 = _createBinaryMarket("Market 0");
        uint256 market1 = _createBinaryMarket("Market 1");

        _depositAndAllocate(userA, userIdA, 5000e6, 3000e6);

        _placeBet(market0, userIdA, 1500e6);
        _placeBet(market1, userIdA, 1500e6);

        vm.prank(admin);
        registry.setResult(market0, 1);
        vm.prank(admin);
        registry.setResult(market1, 0);

        // Claim from both markets — both should succeed
        _recordAndClaim(userA, userIdA, market0, 2000e6);
        _recordAndClaim(userA, userIdA, market1, 1000e6);

        assertTrue(vault.claimed(userIdA, market0));
        assertTrue(vault.claimed(userIdA, market1));
    }

    function _getStatus(uint256 marketId) internal view returns (MarketRegistry.Status) {
        // Auto getter skips dynamic `options` array, so tuple is:
        // (id, question, marketType, closeTime, status, scalarLow, scalarHigh, resultValue, creator, oracleApiUrl)
        (,,,, MarketRegistry.Status status,,,,,) = registry.markets(marketId);
        return status;
    }

    function test_marketLifecycle() public {
        // Open
        uint256 marketId = _createBinaryMarket("Lifecycle test");
        assertEq(uint256(_getStatus(marketId)), uint256(MarketRegistry.Status.Open));

        // Closed
        vm.prank(admin);
        registry.closeMarket(marketId);
        assertEq(uint256(_getStatus(marketId)), uint256(MarketRegistry.Status.Closed));

        // Settled
        vm.prank(admin);
        registry.setResult(marketId, 1);
        assertEq(uint256(_getStatus(marketId)), uint256(MarketRegistry.Status.Settled));

        // FullySettled
        vm.prank(trustedSigner);
        registry.markFullySettled(marketId);
        assertEq(uint256(_getStatus(marketId)), uint256(MarketRegistry.Status.FullySettled));
    }

    function test_cannotBetTwiceSameMarket() public {
        uint256 marketId = _createBinaryMarket("No double bet");

        _depositAndAllocate(userA, userIdA, 2000e6, 2000e6);

        _placeBet(marketId, userIdA, 1000e6);

        vm.prank(operator);
        vm.expectRevert("already bet");
        ingress.placeBet(marketId, userIdA, keccak256("cipher2"), 500e6, 1);
    }

    function test_cannotCloseAlreadySettledMarket() public {
        uint256 marketId = _createBinaryMarket("Already settled");

        vm.prank(admin);
        registry.setResult(marketId, 1);

        vm.prank(admin);
        vm.expectRevert("already settled");
        registry.setResult(marketId, 0);
    }

    function test_cannotCloseSettledMarket() public {
        uint256 marketId = _createBinaryMarket("Close after settle");

        vm.prank(admin);
        registry.setResult(marketId, 1);

        vm.prank(admin);
        vm.expectRevert("not open");
        registry.closeMarket(marketId);
    }

    function test_unauthorizedMarketCreation() public {
        string[] memory opts = new string[](2);
        opts[0] = "Yes";
        opts[1] = "No";

        vm.prank(userA);
        vm.expectRevert("unauthorized");
        registry.createMarket("Hacker market", opts, MarketRegistry.MarketType.Binary, block.timestamp + 1 days, 0, 0, "");
    }
}
