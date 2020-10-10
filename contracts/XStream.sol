pragma solidity 0.5.17;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./XDEX.sol";

interface IXHalflife {
    function createStream(
        address recipient,
        uint256 depositAmount,
        uint256 startBlock,
        uint256 kBlock,
        uint256 unlockRatio
    ) external returns (uint256);

    function isStream(uint256 streamId) external view returns (bool);

    function getStream(uint256 streamId)
        external
        view
        returns (
            address sender,
            address recipient,
            uint256 depositAmount,
            uint256 startBlock,
            uint256 kBlock,
            uint256 remaining,
            uint256 withdrawable,
            uint256 unlockRatio,
            uint256 lastRewardBlock
        );

    function fundStream(uint256 streamId, uint256 amount)
        external
        returns (bool);

    function withdrawFromStream(uint256 streamId, uint256 amount)
        external
        returns (bool);

    function balanceOf(uint256 streamId)
        external
        view
        returns (uint256 withdrawable, uint256 remaining);

    function cancelStream(uint256 streamId) external returns (bool);
}

contract XStream is ReentrancyGuard {
    uint256 constant ONE = 10**18;
    uint256 constant onePercent = 10**16;

    // The XDEX TOKEN!
    XDEX public _xdex;

    /**
     * @notice An interface of XHalfLife, the contract responsible for creating, withdrawing from and cancelling streams.
     */
    IXHalflife public halflife;

    struct LockStream {
        address depositor;
        bool isEntity;
        uint256 streamId;
    }

    uint256 constant unlockRatio = onePercent / 10; //0.1%

    //funds from Voting Pool
    uint256 constant unlockKBlocksV = 1800;
    // key: recipient, value: Locked Stream
    mapping(address => LockStream) private votingStreams;

    //funds from Normal Pool
    uint256 constant unlockKBlocksN = 40;
    // key: recipient, value: Locked Stream
    mapping(address => LockStream) private normalStreams;

    /**
     * @notice User can have at most one votingStream and one normalStream.
     */
    modifier lockStreamExists(address who, uint256 streamType) {
        bool found = false;
        if (streamType == 0) {
            found = votingStreams[who].isEntity;
        } else if (streamType == 1) {
            found = normalStreams[who].isEntity;
        }

        require(found, "the lock stream does not exist");
        _;
    }

    modifier validStreamType(uint256 streamType) {
        require(
            streamType == 0 || streamType == 1,
            "invalid stream type: 0 or 1"
        );
        _;
    }

    event Create(
        address indexed sender,
        address indexed recipient,
        uint256 indexed streamId,
        uint256 streamType,
        uint256 depositAmount,
        uint256 startBlock
    );

    event Withdraw(
        address indexed withdrawer,
        uint256 indexed streamId,
        uint256 indexed amount,
        uint256 streamType,
        bool result
    );

    event Fund(
        address indexed sender,
        uint256 indexed streamId,
        uint256 indexed amount
    );

    constructor(XDEX _xdexToken, address _halflife) public {
        _xdex = _xdexToken;
        halflife = IXHalflife(_halflife);
    }

    /**
     * If the user has VotingStream or has NormalStream.
     */
    function hasStream(address who)
        public
        view
        returns (bool hasVotingStream, bool hasNormalStream)
    {
        hasVotingStream = votingStreams[who].isEntity;
        hasNormalStream = normalStreams[who].isEntity;
    }

    /**
     * @notice Get a user's voting or normal stream id.
     * @dev stream id must > 0.
     * @param streamType The type of stream: 0 is votingStream, 1 is normalStream;
     */
    function getStreamId(address who, uint256 streamType)
        public
        view
        lockStreamExists(who, streamType)
        returns (uint256 streamId)
    {
        if (streamType == 0) {
            return votingStreams[who].streamId;
        } else if (streamType == 1) {
            return normalStreams[who].streamId;
        }
    }

    /**
     * @notice Creates a new stream funded by `msg.sender` and paid towards to `recipient`.
     * @param streamType The type of stream: 0 is votingStream, 1 is normalStream;
     */
    function createStream(
        address recipient,
        uint256 depositAmount,
        uint256 streamType,
        uint256 startBlock
    )
        external
        nonReentrant
        validStreamType(streamType)
        returns (uint256 streamId)
    {
        uint256 unlockKBlocks = unlockKBlocksN;
        if (streamType == 0) {
            unlockKBlocks = unlockKBlocksV;
        }

        /* Approve the XHalflife contract to spend. */
        _xdex.approve(address(halflife), depositAmount);

        /* Transfer the tokens to this contract. */
        _xdex.transferFrom(msg.sender, address(this), depositAmount);

        streamId = halflife.createStream(
            recipient,
            depositAmount,
            startBlock,
            unlockKBlocks,
            unlockRatio
        );

        if (streamType == 0) {
            votingStreams[recipient] = LockStream({
                depositor: msg.sender,
                isEntity: true,
                streamId: streamId
            });
        } else if (streamType == 1) {
            normalStreams[recipient] = LockStream({
                depositor: msg.sender,
                isEntity: true,
                streamId: streamId
            });
        }

        emit Create(
            msg.sender,
            recipient,
            streamId,
            streamType,
            depositAmount,
            startBlock
        );
    }

    /**
     * @notice Send funds to the stream
     * @param streamId The given stream id;
     * @param amount New amount fund to add;
     */
    function fundsToStream(uint256 streamId, uint256 amount)
        public
        returns (bool result)
    {
        require(amount > 0, "amount is zero");

        /* Approve the XHalflife contract to spend. */
        _xdex.approve(address(halflife), amount);

        /* Transfer the tokens to this contract. */
        _xdex.transferFrom(msg.sender, address(this), amount);

        result = halflife.fundStream(streamId, amount);

        emit Fund(msg.sender, streamId, amount);
    }

    /**
     * @notice Withdraw from the votingStream or normalStream; `msg.sender` must be `recipient`
     * @param streamType The type of stream: 0 is votingStream, 1 is normalStream;
     * @param amount Withdraw amount
     */
    function withdraw(uint256 streamType, uint256 amount)
        external
        validStreamType(streamType)
        returns (bool result)
    {
        uint256 streamId = 0;
        if (streamType == 0) {
            require(
                votingStreams[msg.sender].isEntity,
                "senders votingStream not exist"
            );
            streamId = votingStreams[msg.sender].streamId;
        } else if (streamType == 1) {
            require(
                normalStreams[msg.sender].isEntity,
                "senders normalStream not exist"
            );
            streamId = normalStreams[msg.sender].streamId;
        }

        (, address recipient, , , , , , , ) = halflife.getStream(streamId);
        require(msg.sender == recipient, "user must be stream recipient");

        result = halflife.withdrawFromStream(streamId, amount);

        emit Withdraw(msg.sender, streamId, amount, streamType, result);
    }
}
