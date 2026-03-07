// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MarketRegistry {
    enum MarketType { Binary, Categorical, Scalar }
    enum Status { Open, Closed, Settled, FullySettled }

    struct Market {
        uint256 id;
        string question;
        string[] options;
        MarketType marketType;
        uint256 closeTime;
        Status status;
        int256 scalarLow;
        int256 scalarHigh;
        int256 resultValue;
        address creator;
        string oracleApiUrl;
    }

    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;
    address public admin;
    address public trustedSigner;

    event MarketCreated(uint256 indexed marketId, MarketType marketType, string question);
    event MarketClosed(uint256 indexed marketId);
    event MarketSettled(uint256 indexed marketId, int256 resultValue);
    event MarketFullySettled(uint256 indexed marketId);

    modifier onlyAdminOrTrusted() {
        require(msg.sender == admin || msg.sender == trustedSigner, "unauthorized");
        _;
    }

    modifier onlyTrustedSigner() {
        require(msg.sender == trustedSigner, "only trusted signer");
        _;
    }

    constructor(address _admin, address _trustedSigner) {
        admin = _admin;
        trustedSigner = _trustedSigner;
    }

    function createMarket(
        string calldata question,
        string[] memory options,
        MarketType marketType,
        uint256 closeTime,
        int256 scalarLow,
        int256 scalarHigh,
        string calldata oracleApiUrl
    ) external onlyAdminOrTrusted returns (uint256) {
        require(closeTime > block.timestamp, "closeTime must be future");
        if (marketType == MarketType.Binary) {
            require(options.length == 2, "binary needs 2 options");
        } else if (marketType == MarketType.Categorical) {
            require(options.length >= 2, "need at least 2 options");
        } else if (marketType == MarketType.Scalar) {
            require(scalarLow < scalarHigh, "invalid scalar range");
        }

        uint256 marketId = nextMarketId++;
        Market storage m = markets[marketId];
        m.id = marketId;
        m.question = question;
        m.options = options;
        m.marketType = marketType;
        m.closeTime = closeTime;
        m.status = Status.Open;
        m.scalarLow = scalarLow;
        m.scalarHigh = scalarHigh;
        m.creator = msg.sender;
        m.oracleApiUrl = oracleApiUrl;

        emit MarketCreated(marketId, marketType, question);
        return marketId;
    }

    function closeMarket(uint256 marketId) external onlyAdminOrTrusted {
        Market storage m = markets[marketId];
        require(m.status == Status.Open, "not open");
        m.status = Status.Closed;
        emit MarketClosed(marketId);
    }

    function setResult(uint256 marketId, int256 resultValue) external onlyAdminOrTrusted {
        Market storage m = markets[marketId];
        require(m.status == Status.Open || m.status == Status.Closed, "already settled");
        m.status = Status.Settled;
        m.resultValue = resultValue;
        emit MarketSettled(marketId, resultValue);
    }

    function markFullySettled(uint256 marketId) external onlyTrustedSigner {
        Market storage m = markets[marketId];
        require(m.status == Status.Settled, "not settled");
        m.status = Status.FullySettled;
        emit MarketFullySettled(marketId);
    }

    function getMarketOptions(uint256 marketId) external view returns (string[] memory) {
        return markets[marketId].options;
    }
}
