// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import "lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

contract Vault {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    IERC20 public token;
    address public operator;
    address public trustedSigner;

    mapping(bytes32 => uint256) public deposits;
    mapping(bytes32 => uint256) public allocated;
    mapping(bytes32 => mapping(uint256 => uint256)) public claimable;
    mapping(bytes32 => mapping(uint256 => bool)) public claimed;

    event Deposited(bytes32 indexed hashedUserId, uint256 amount);
    event Allocated(bytes32 indexed hashedUserId, uint256 amount);
    event PayoutRecorded(bytes32 indexed hashedUserId, uint256 indexed marketId, uint256 amount);
    event Claimed(bytes32 indexed hashedUserId, uint256 indexed marketId, address to, uint256 amount);

    modifier onlyOperator() {
        require(msg.sender == operator, "only operator");
        _;
    }

    constructor(address _token, address _operator, address _trustedSigner) {
        token = IERC20(_token);
        operator = _operator;
        trustedSigner = _trustedSigner;
    }

    function deposit(bytes32 hashedUserId, uint256 amount) external {
        require(amount > 0, "amount must be > 0");
        token.safeTransferFrom(msg.sender, address(this), amount);
        deposits[hashedUserId] += amount;
        emit Deposited(hashedUserId, amount);
    }

    function allocate(bytes32 hashedUserId, uint256 amount) external onlyOperator {
        require(available(hashedUserId) >= amount, "insufficient");
        allocated[hashedUserId] += amount;
        emit Allocated(hashedUserId, amount);
    }

    function recordPayout(
        bytes32 hashedUserId, uint256 marketId, uint256 amount, bytes calldata creSignature
    ) external {
        bytes32 messageHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, block.chainid, address(this)
        ));
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", messageHash
        ));
        require(ethSignedHash.recover(creSignature) == trustedSigner, "invalid CRE signature");

        claimable[hashedUserId][marketId] = amount;
        emit PayoutRecorded(hashedUserId, marketId, amount);
    }

    function claim(
        bytes32 hashedUserId, uint256 marketId, uint256 amount,
        uint256 deadline, bytes calldata backendSig
    ) external {
        require(block.timestamp <= deadline, "expired");
        require(claimable[hashedUserId][marketId] == amount, "amount mismatch");
        require(!claimed[hashedUserId][marketId], "already claimed");

        bytes32 messageHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, deadline, block.chainid, address(this)
        ));
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", messageHash
        ));
        require(ethSignedHash.recover(backendSig) == operator, "invalid backend signature");

        claimed[hashedUserId][marketId] = true;
        token.safeTransfer(msg.sender, amount);
        emit Claimed(hashedUserId, marketId, msg.sender, amount);
    }

    function available(bytes32 hashedUserId) public view returns (uint256) {
        return deposits[hashedUserId] - allocated[hashedUserId];
    }
}
