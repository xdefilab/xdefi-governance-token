pragma solidity 0.5.17;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IXHalfLife.sol";

contract XdexStream is ReentrancyGuard {
    uint256 constant ONE = 10**18;
    uint256 constant onePercent = 10**16;

    //The XDEX Token!
    address public xdex;
    address public xdexFarmMaster;

    /**
     * @notice An interface of XHalfLife, the contract responsible for creating, funding and withdrawing from streams.
     * No one could cancle the xdex resward stream except the recipient, because the stream sender is this contract.
     */
    IXHalfLife public halflife;

    struct LockStream {
        address depositor;
        bool isEntity;
        uint256 streamId;
    }

    //unlock ratio for both Voting and Normal Pool
    uint256 constant unlockRatio = onePercent / 10; //0.1%

    //unlock k block for Voting Pool
    uint256 constant unlockKBlocksV = 1800;
    // key: recipient, value: Locked Stream
    mapping(address => LockStream) private votingStreams;

    //funds for Normal Pool
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
            //voting stream
            found = votingStreams[who].isEntity;
        } else if (streamType == 1) {
            //normal stream
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

    constructor(
        address _xdex,
        address _halfLife,
        address _farmMaster
    ) public {
        xdex = _xdex;
        halflife = IXHalfLife(_halfLife);
        xdexFarmMaster = _farmMaster;
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
        require(msg.sender == xdexFarmMaster, "only farmMaster could create");
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
        IERC20(xdex).approve(address(halflife), depositAmount);

        /* Transfer the tokens to this contract. */
        IERC20(xdex).transferFrom(msg.sender, address(this), depositAmount);

        streamId = halflife.createStream(
            xdex,
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
        IERC20(xdex).approve(address(halflife), amount);

        /* Transfer the tokens to this contract. */
        IERC20(xdex).transferFrom(msg.sender, address(this), amount);

        result = halflife.fundStream(streamId, amount);
    }
}
