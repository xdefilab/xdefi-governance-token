pragma solidity 0.5.17;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interface/IXHalfLife.sol";

contract XdexStream is ReentrancyGuard {
    uint256 constant ONE = 10**18;
    uint256 constant onePercent = 10**16;

    IERC20 public xdex;

    // Should be FarmMaster Contract
    address public core;

    /**
     * @notice An interface of XHalfLife, the contract responsible for creating, funding and withdrawing from streams.
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
     * @param streamType The type of stream: 0 is votingStream, 1 is normalStream;
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

    /**
     * @dev Throws if the msg.sender unauthorized.
     */
    modifier onlyCore() {
        require(msg.sender == core, "Not authorized, only core");
        _;
    }

    event SET_CORE(address indexed _core, address indexed _coreNew);

    constructor(IERC20 _xdex, address _halflife) public {
        xdex = _xdex;
        halflife = IXHalflife(_halflife);
        core = msg.sender;
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
        onlyCore
        returns (uint256 streamId)
    {
        require(recipient != address(0), "stream to the zero address");
        require(recipient != address(this), "stream to the contract itself");
        require(recipient != msg.sender, "stream to the caller");
        require(depositAmount > 0, "depositAmount is zero");
        require(startBlock >= block.number, "start block before block.number");

        if (streamType == 0) {
            require(
                !(votingStreams[recipient].isEntity),
                "voting stream exists"
            );
        }
        if (streamType == 1) {
            require(
                !(normalStreams[recipient].isEntity),
                "normal stream exists"
            );
        }

        uint256 unlockKBlocks = unlockKBlocksN;
        if (streamType == 0) {
            unlockKBlocks = unlockKBlocksV;
        }

        /* Approve the XHalflife contract to spend. */
        xdex.approve(address(halflife), depositAmount);

        /* Transfer the tokens to this contract. */
        xdex.transferFrom(msg.sender, address(this), depositAmount);

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
        xdex.approve(address(halflife), amount);

        /* Transfer the tokens to this contract. */
        xdex.transferFrom(msg.sender, address(this), amount);

        result = halflife.fundStream(streamId, amount);
    }

    // core: Should be FarmMaster Contract
    function setCore(address _core) public onlyCore {
        emit SET_CORE(core, _core);
        core = _core;
    }
}
