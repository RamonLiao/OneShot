// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BetIngress {
    mapping(bytes32 => mapping(uint256 => bool)) public hasBet;
    address public operator;

    event BetPlaced(
        uint256 indexed marketId,
        bytes32 indexed hashedUserId,
        bytes32 ciphertextHash,
        uint256 amount,
        uint8 sourceChainId
    );

    modifier onlyOperator() {
        require(msg.sender == operator, "only operator");
        _;
    }

    constructor(address _operator) {
        operator = _operator;
    }

    function placeBet(
        uint256 marketId,
        bytes32 hashedUserId,
        bytes32 ciphertextHash,
        uint256 amount,
        uint8 sourceChainId
    ) external onlyOperator {
        require(!hasBet[hashedUserId][marketId], "already bet");
        require(amount > 0, "amount must be > 0");
        hasBet[hashedUserId][marketId] = true;
        emit BetPlaced(marketId, hashedUserId, ciphertextHash, amount, sourceChainId);
    }
}
