pragma solidity 0.5.17;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./XDEX.sol";

contract XHalfLife is ReentrancyGuard {
    using SafeMath for uint256;

    uint256 constant ONE = 10**18;
    uint256 constant onePercent = 10**16;
    uint256 constant effectiveValue = 10**14; //effective withdrawable value: 0.0001

    // The XDEX TOKEN!
    XDEX public _xdex;

    /**
     * @notice Counter for new stream ids.
     */
    uint256 public nextStreamId = 1;

    // halflife stream
    struct Stream {
        uint256 depositAmount;
        uint256 remaining; //un-withdrawable balance
        uint256 withdrawable; //withdrawable balance
        uint256 startBlock;
        uint256 kBlock;
        uint256 unlockRatio;
        uint256 lastRewardBlock;
        address recipient;
        address sender;
        bool isEntity;
    }

    /**
     * @notice The stream objects identifiable by their unsigned integer ids.
     */
    mapping(uint256 => Stream) public streams;

    /**
     * @dev Throws if the provided id does not point to a valid stream.
     */
    modifier streamExists(uint256 streamId) {
        require(streams[streamId].isEntity, "stream does not exist");
        _;
    }

    /**
     * @dev Throws if the caller is not the sender of the recipient of the stream.
     */
    modifier onlySenderOrRecipient(uint256 streamId) {
        require(
            msg.sender == streams[streamId].sender ||
                msg.sender == streams[streamId].recipient,
            "caller is not the sender or the recipient of the stream"
        );
        _;
    }

    event StreamCreated(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        uint256 depositAmount,
        uint256 startBlock,
        uint256 kBlock,
        uint256 unlockRatio
    );

    event WithdrawFromStream(
        uint256 indexed streamId,
        address indexed recipient,
        uint256 amount
    );

    event StreamCanceled(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        uint256 senderBalance,
        uint256 recipientBalance
    );

    event StreamFunded(uint256 indexed streamId, uint256 amount);

    constructor(XDEX _xdexToken) public {
        _xdex = _xdexToken;
    }

    /**
     * @notice Creates a new stream funded by `msg.sender` and paid towards `recipient`.
     * @dev Throws if paused.
     *  Throws if the recipient is the zero address, the contract itself or the caller.
     *  Throws if the depositAmount is 0.
     *  Throws if the start block is before `block.number`.
     *  Throws if the rate calculation has a math error.
     *  Throws if the next stream id calculation has a math error.
     *  Throws if the contract is not allowed to transfer enough tokens.
     * @param recipient The address towards which the money is streamed.
     * @param depositAmount The amount of money to be streamed.
     * @param startBlock stream start block
     * @param kBlock unlock every k blocks
     * @param unlockRatio unlock ratio from remaining balanceß
     * @return The uint256 id of the newly created stream.
     */
    function createStream(
        address recipient,
        uint256 depositAmount,
        uint256 startBlock,
        uint256 kBlock,
        uint256 unlockRatio
    ) external nonReentrant returns (uint256) {
        require(recipient != address(0), "stream to the zero address");
        require(recipient != address(this), "stream to the contract itself");
        require(recipient != msg.sender, "stream to the caller");
        require(depositAmount > 0, "depositAmount is zero");
        require(startBlock >= block.number, "start block before block.number");
        require(kBlock > 0, "k block is zero");
        require(unlockRatio >= onePercent / 10, "unlockRatio must >= 0.1%");
        require(unlockRatio < ONE, "unlockRatio must < 100%");

        /* Create and store the stream object. */
        uint256 streamId = nextStreamId;
        streams[streamId] = Stream({
            remaining: depositAmount,
            withdrawable: 0,
            depositAmount: depositAmount,
            startBlock: startBlock,
            kBlock: kBlock,
            unlockRatio: unlockRatio,
            lastRewardBlock: startBlock,
            recipient: recipient,
            sender: msg.sender,
            isEntity: true
        });

        nextStreamId = nextStreamId.add(1);

        _xdex.transferFrom(address(msg.sender), address(this), depositAmount);

        emit StreamCreated(
            streamId,
            msg.sender,
            recipient,
            depositAmount,
            startBlock,
            kBlock,
            unlockRatio
        );
        return streamId;
    }

    /**
     * @notice If the given streamId is valid;
     * @param streamId The id of the stream to query.
     */
    function isStream(uint256 streamId) external view returns (bool) {
        return streams[streamId].isEntity;
    }

    /**
     * @notice Returns the stream with all its properties.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId The id of the stream to query.
     * @return The stream object.
     */
    function getStream(uint256 streamId)
        external
        view
        streamExists(streamId)
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
        )
    {
        sender = streams[streamId].sender;
        recipient = streams[streamId].recipient;
        depositAmount = streams[streamId].depositAmount;
        startBlock = streams[streamId].startBlock;
        kBlock = streams[streamId].kBlock;
        remaining = streams[streamId].remaining;
        withdrawable = streams[streamId].withdrawable;
        unlockRatio = streams[streamId].unlockRatio;
        lastRewardBlock = streams[streamId].lastRewardBlock;
    }

    /**
     * @notice funds to an existing stream.
     * Throws if the caller is not the stream.sender
     * @param streamId The id of the stream to query.
     * @param amount deposit amount by stream sender
     */
    function fundStream(uint256 streamId, uint256 amount)
        public
        nonReentrant
        streamExists(streamId)
        returns (bool)
    {
        require(
            msg.sender == streams[streamId].sender,
            "caller must be the sender of the stream"
        );
        require(amount > 0, "amount is zero");

        (uint256 recipientBalance, uint256 remainingBalance) = balanceOf(
            streamId
        );

        uint256 m = block.number.sub(streams[streamId].startBlock).mod(
            streams[streamId].kBlock
        );
        uint256 lastRewardBlock = block.number.sub(m);

        streams[streamId].lastRewardBlock = lastRewardBlock;
        streams[streamId].remaining = remainingBalance.add(amount);
        streams[streamId].withdrawable = recipientBalance;

        //add funds to total deposit amount
        streams[streamId].depositAmount = streams[streamId].depositAmount.add(
            amount
        );

        _xdex.transferFrom(msg.sender, address(this), amount);

        emit StreamFunded(streamId, amount);

        return true;
    }

    /**
     * @notice Returns the available funds for the given stream id and address.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId The id of the stream for which to query the balance.
     * @return The total funds allocated to `recipient` and `sender` as uint256.
     */
    function balanceOf(uint256 streamId)
        public
        view
        streamExists(streamId)
        returns (uint256 withdrawable, uint256 remaining)
    {
        Stream memory stream = streams[streamId];

        if (block.number < stream.startBlock) {
            return (0, stream.depositAmount);
        }

        uint256 lastBalance = stream.withdrawable;

        //If `remaining` not equal zero, it means there have been added funds.
        uint256 r = stream.remaining;
        uint256 w = 0;
        uint256 n = block.number.sub(stream.lastRewardBlock).div(stream.kBlock);
        for (uint256 i = 0; i < n; i++) {
            uint256 reward = r.mul(stream.unlockRatio).div(ONE);
            w = w.add(reward);
            r = r.sub(reward);
        }

        stream.remaining = r;
        stream.withdrawable = w;
        if (lastBalance > 0) {
            stream.withdrawable = stream.withdrawable.add(lastBalance);
        }

        //If `remaining` + `withdrawable` < `depositAmount`, it means there have withdraws.
        require(
            stream.remaining.add(stream.withdrawable) <= stream.depositAmount,
            "balanceOf: remaining or withdrawable amount is bad"
        );

        if (stream.withdrawable >= effectiveValue) {
            withdrawable = stream.withdrawable;
        } else {
            withdrawable = 0;
        }

        if (stream.remaining >= effectiveValue) {
            remaining = stream.remaining;
        } else {
            remaining = 0;
        }
    }

    /**
     * @notice Withdraws from the contract to the recipient's account.
     * @dev Throws if the id does not point to a valid stream.
     *  Throws if the amount exceeds the withdrawable balance.
     *  Throws if the amount < the effective withdraw value.
     *  Throws if the caller is not the recipient.
     * @param streamId The id of the stream to withdraw tokens from.
     * @param amount The amount of tokens to withdraw.
     * @return bool true=success, otherwise false.
     */
    function withdrawFromStream(uint256 streamId, uint256 amount)
        external
        nonReentrant
        streamExists(streamId)
        onlySenderOrRecipient(streamId)
        returns (bool)
    {
        require(
            amount >= effectiveValue,
            "amount is zero or little than the effective withdraw value"
        );

        (uint256 recipientBalance, uint256 remainingBalance) = balanceOf(
            streamId
        );

        require(
            recipientBalance >= amount,
            "withdraw amount exceeds the available balance"
        );

        uint256 m = block.number.sub(streams[streamId].startBlock).mod(
            streams[streamId].kBlock
        );
        uint256 lastRewardBlock = block.number.sub(m);

        streams[streamId].lastRewardBlock = lastRewardBlock;
        streams[streamId].remaining = remainingBalance;
        streams[streamId].withdrawable = recipientBalance.sub(amount);

        _safeXDexTransfer(streams[streamId].recipient, amount);
        emit WithdrawFromStream(streamId, streams[streamId].recipient, amount);
        return true;
    }

    /**
     * @notice Cancels the stream and transfers the tokens back
     * @dev Throws if the id does not point to a valid stream.
     *  Throws if the caller is not the sender or the recipient of the stream.
     *  Throws if there is a token transfer failure.
     * @param streamId The id of the stream to cancel.
     * @return bool true=success, otherwise false.
     */
    function cancelStream(uint256 streamId)
        external
        nonReentrant
        streamExists(streamId)
        onlySenderOrRecipient(streamId)
        returns (bool)
    {
        Stream memory stream = streams[streamId];
        (uint256 withdrawable, uint256 remaining) = balanceOf(streamId);

        //save gas
        delete streams[streamId];

        if (withdrawable > 0) {
            _safeXDexTransfer(stream.recipient, withdrawable);
        }
        if (remaining > 0) {
            _safeXDexTransfer(stream.sender, remaining);
        }

        emit StreamCanceled(
            streamId,
            stream.sender,
            stream.recipient,
            withdrawable,
            remaining
        );
        return true;
    }

    function getVersion() external pure returns (bytes32) {
        return bytes32("APOLLO");
    }

    // Safe xdex transfer function, just in case if rounding error causes pool to not have enough XDEX.
    function _safeXDexTransfer(address _to, uint256 _amount) internal {
        uint256 xdexBal = _xdex.balanceOf(address(this));
        if (_amount > xdexBal) {
            _xdex.transfer(_to, xdexBal);
        } else {
            _xdex.transfer(_to, _amount);
        }
    }

    function _isContract(address _target) internal view returns (bool) {
        if (_target == address(0)) {
            return false;
        }
        uint256 size;
        assembly {
            size := extcodesize(_target)
        }
        return size > 0;
    }
}
