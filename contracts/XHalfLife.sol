pragma solidity 0.5.17;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./lib/AddressHelper.sol";
import "./lib/XNum.sol";
import "./interfaces/IERC20.sol";

contract XHalfLife is ReentrancyGuard {
    using SafeMath for uint256;
    using AddressHelper for address;

    uint256 private constant ONE = 10**18;

    /**
     * @notice Counter for new stream ids.
     */
    uint256 public nextStreamId = 1;

    /**
     * @notice key: stream id, value: minimum effective value(0.0001 TOKEN)
     */
    mapping(uint256 => uint256) public effectiveValues;

    // halflife stream
    struct Stream {
        uint256 depositAmount; // total deposited amount, must >= 0.0001 TOKEN
        uint256 remaining; // un-withdrawable balance
        uint256 withdrawable; // withdrawable balance
        uint256 startBlock; // when should start
        uint256 kBlock; // interval K blocks
        uint256 unlockRatio; // must be between [1-1000], which means 0.1% to 100%
        uint256 denom; // one readable coin represent
        uint256 lastRewardBlock; // update by create(), fund() and withdraw()
        address token; // ERC20 token address or 0xEe for Ether
        address recipient;
        address sender;
        bool cancelable; // can be cancelled or not
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
     *  Throws if the recipient is the zero address, the contract itself or the caller.
     *  Throws if the depositAmount is 0.
     *  Throws if the start block is before `block.number`.
     */
    modifier createStreamPreflight(
        address recipient,
        uint256 depositAmount,
        uint256 startBlock,
        uint256 kBlock
    ) {
        require(recipient != address(0), "stream to the zero address");
        require(recipient != address(this), "stream to the contract itself");
        require(recipient != msg.sender, "stream to the caller");
        require(depositAmount > 0, "deposit amount is zero");
        require(startBlock >= block.number, "start block before block.number");
        require(kBlock > 0, "k block is zero");
        _;
    }

    event StreamCreated(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 depositAmount,
        uint256 startBlock,
        uint256 kBlock,
        uint256 unlockRatio,
        bool cancelable
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

    /**
     * @notice Creates a new stream funded by `msg.sender` and paid towards `recipient`.
     * @dev Throws if paused.
     *  Throws if the token is not a contract address
     *  Throws if the recipient is the zero address, the contract itself or the caller.
     *  Throws if the depositAmount is 0.
     *  Throws if the start block is before `block.number`.
     *  Throws if the rate calculation has a math error.
     *  Throws if the next stream id calculation has a math error.
     *  Throws if the contract is not allowed to transfer enough tokens.
     * @param token The ERC20 token address
     * @param recipient The address towards which the money is streamed.
     * @param depositAmount The amount of money to be streamed.
     * @param startBlock stream start block
     * @param kBlock unlock every k blocks
     * @param unlockRatio unlock ratio from remaining balance,
     *                    value must be between [1-1000], which means 0.1% to 1%
     * @param cancelable can be cancelled or not
     * @return The uint256 id of the newly created stream.
     */
    function createStream(
        address token,
        address recipient,
        uint256 depositAmount,
        uint256 startBlock,
        uint256 kBlock,
        uint256 unlockRatio,
        bool cancelable
    )
        external
        createStreamPreflight(recipient, depositAmount, startBlock, kBlock)
        returns (uint256 streamId)
    {
        require(unlockRatio <= 1000, "unlockRatio must <= 1000");
        require(unlockRatio > 0, "unlockRatio must > 0");

        require(token.isContract(), "not contract");
        token.safeTransferFrom(msg.sender, address(this), depositAmount);

        streamId = nextStreamId;
        {
            uint256 denom = 10**uint256(IERC20(token).decimals());
            require(denom >= 10**6, "token decimal too small");

            // 0.0001 TOKEN
            effectiveValues[streamId] = denom.div(10**4);
            require(
                depositAmount >= effectiveValues[streamId],
                "deposit too small"
            );

            streams[streamId] = Stream({
                token: token,
                remaining: depositAmount,
                withdrawable: 0,
                depositAmount: depositAmount,
                startBlock: startBlock,
                kBlock: kBlock,
                unlockRatio: unlockRatio,
                denom: denom,
                lastRewardBlock: startBlock,
                recipient: recipient,
                sender: msg.sender,
                isEntity: true,
                cancelable: cancelable
            });
        }

        nextStreamId = nextStreamId.add(1);
        emit StreamCreated(
            streamId,
            msg.sender,
            recipient,
            token,
            depositAmount,
            startBlock,
            kBlock,
            unlockRatio,
            cancelable
        );
    }

    /**
     * @notice Creates a new ether stream funded by `msg.sender` and paid towards `recipient`.
     * @dev Throws if paused.
     *  Throws if the recipient is the zero address, the contract itself or the caller.
     *  Throws if the depositAmount is 0.
     *  Throws if the start block is before `block.number`.
     *  Throws if the rate calculation has a math error.
     *  Throws if the next stream id calculation has a math error.
     *  Throws if the contract is not allowed to transfer enough tokens.
     * @param recipient The address towards which the money is streamed.
     * @param startBlock stream start block
     * @param kBlock unlock every k blocks
     * @param unlockRatio unlock ratio from remaining balance
     * @param cancelable can be cancelled or not
     * @return The uint256 id of the newly created stream.
     */
    function createEtherStream(
        address recipient,
        uint256 startBlock,
        uint256 kBlock,
        uint256 unlockRatio,
        bool cancelable
    )
        external
        payable
        createStreamPreflight(recipient, msg.value, startBlock, kBlock)
        returns (uint256 streamId)
    {
        require(unlockRatio <= 1000, "unlockRatio must <= 1000");
        require(unlockRatio > 0, "unlockRatio must > 0");
        require(msg.value >= 10**14, "deposit too small");

        /* Create and store the stream object. */
        streamId = nextStreamId;
        streams[streamId] = Stream({
            token: AddressHelper.ethAddress(),
            remaining: msg.value,
            withdrawable: 0,
            depositAmount: msg.value,
            startBlock: startBlock,
            kBlock: kBlock,
            unlockRatio: unlockRatio,
            denom: 10**18,
            lastRewardBlock: startBlock,
            recipient: recipient,
            sender: msg.sender,
            isEntity: true,
            cancelable: cancelable
        });

        nextStreamId = nextStreamId.add(1);
        emit StreamCreated(
            streamId,
            msg.sender,
            recipient,
            AddressHelper.ethAddress(),
            msg.value,
            startBlock,
            kBlock,
            unlockRatio,
            cancelable
        );
    }

    /**
     * @notice Check if given stream exists.
     * @param streamId The id of the stream to query.
     * @return bool true=exists, otherwise false.
     */
    function hasStream(uint256 streamId) external view returns (bool) {
        return streams[streamId].isEntity;
    }

    /**
     * @notice Returns the stream with all its properties.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId The id of the stream to query.
     * @return sender
     * @return recipient
     * @return token
     * @return depositAmount
     * @return startBlock
     * @return kBlock
     * @return remaining
     * @return withdrawable
     * @return unlockRatio
     * @return lastRewardBlock
     * @return cancelable
     */
    function getStream(uint256 streamId)
        external
        view
        streamExists(streamId)
        returns (
            address sender,
            address recipient,
            address token,
            uint256 depositAmount,
            uint256 startBlock,
            uint256 kBlock,
            uint256 remaining,
            uint256 withdrawable,
            uint256 unlockRatio,
            uint256 lastRewardBlock,
            bool cancelable
        )
    {
        Stream memory stream = streams[streamId];
        sender = stream.sender;
        recipient = stream.recipient;
        token = stream.token;
        depositAmount = stream.depositAmount;
        startBlock = stream.startBlock;
        kBlock = stream.kBlock;
        remaining = stream.remaining;
        withdrawable = stream.withdrawable;
        unlockRatio = stream.unlockRatio;
        lastRewardBlock = stream.lastRewardBlock;
        cancelable = stream.cancelable;
    }

    /**
     * @notice funds to an existing stream.
     * Throws if the caller is not the stream.sender
     * @param streamId The id of the stream to query.
     * @param amount deposit amount by stream sender
     */
    function fundStream(uint256 streamId, uint256 amount)
        external
        payable
        nonReentrant
        streamExists(streamId)
        returns (bool)
    {
        Stream storage stream = streams[streamId];
        require(
            msg.sender == stream.sender,
            "caller must be the sender of the stream"
        );
        require(amount > effectiveValues[streamId], "amount not effective");
        if (stream.token == AddressHelper.ethAddress()) {
            require(amount == msg.value, "bad ether fund");
        } else {
            stream.token.safeTransferFrom(msg.sender, address(this), amount);
        }

        (uint256 withdrawable, uint256 remaining) = balanceOf(streamId);

        uint256 blockHeightDiff = block.number.sub(stream.lastRewardBlock);
        uint256 m = amount.mul(stream.kBlock).div(blockHeightDiff); //If underflow m might be 0
        uint256 noverk = blockHeightDiff.mul(ONE).div(stream.kBlock);
        uint256 mu = stream.unlockRatio.mul(ONE).div(1000);
        uint256 onesubmu = ONE.sub(mu);
        // uint256 s = m.mul(ONE.sub(XNum.bpow(onesubmu,noverk))).div(ONE).div(mu).mul(ONE);
        uint256 s = m.mul(ONE.sub(XNum.bpow(onesubmu, noverk))).div(mu);

        // update remaining and withdrawable balance
        stream.lastRewardBlock = block.number;
        stream.remaining = remaining.add(amount * 2).sub(s); // = remaining + amount + (amount - s)
        stream.withdrawable = withdrawable.add(s).sub(amount); // = withdrawable - amount + s

        //add funds to total deposit amount
        stream.depositAmount = stream.depositAmount.add(amount);
        emit StreamFunded(streamId, amount);
        return true;
    }

    /**
     * @notice Returns the available funds for the given stream id and address.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId The id of the stream for which to query the balance.
     * @return withdrawable The total funds allocated to `recipient` and `sender` as uint256.
     * @return remaining The total funds allocated to `recipient` and `sender` as uint256.
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

        uint256 n =
            block.number.sub(stream.lastRewardBlock).mul(ONE).div(
                stream.kBlock
            );
        uint256 k = stream.unlockRatio.mul(ONE).div(1000);
        uint256 mu = ONE.sub(k);
        uint256 r = stream.remaining.mul(XNum.bpow(mu, n)).div(ONE);
        uint256 w = stream.remaining.sub(r); // withdrawable, if n is float this process will be smooth and slightly

        if (lastBalance > 0) {
            w = w.add(lastBalance);
        }

        //If `remaining` + `withdrawable` < `depositAmount`, it means there have withdraws.
        require(
            r.add(w) <= stream.depositAmount,
            "balanceOf: remaining or withdrawable amount is bad"
        );

        if (w >= effectiveValues[streamId]) {
            withdrawable = w;
        } else {
            withdrawable = 0;
        }

        if (r >= effectiveValues[streamId]) {
            remaining = r;
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
        returns (bool)
    {
        Stream storage stream = streams[streamId];

        require(
            msg.sender == stream.recipient,
            "caller must be the recipient of the stream"
        );

        require(
            amount >= effectiveValues[streamId],
            "amount is zero or not effective"
        );

        (uint256 withdrawable, uint256 remaining) = balanceOf(streamId);

        require(
            withdrawable >= amount,
            "withdraw amount exceeds the available balance"
        );

        if (stream.token == AddressHelper.ethAddress()) {
            stream.recipient.safeTransferEther(amount);
        } else {
            stream.token.safeTransfer(stream.recipient, amount);
        }

        stream.lastRewardBlock = block.number;
        stream.remaining = remaining;
        stream.withdrawable = withdrawable.sub(amount);

        emit WithdrawFromStream(streamId, stream.recipient, amount);
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
        returns (bool)
    {
        Stream memory stream = streams[streamId];

        require(stream.cancelable, "non cancelable stream");
        require(
            msg.sender == streams[streamId].sender ||
                msg.sender == streams[streamId].recipient,
            "caller must be the sender or the recipient"
        );

        (uint256 withdrawable, uint256 remaining) = balanceOf(streamId);

        //save gas
        delete streams[streamId];
        delete effectiveValues[streamId];

        if (withdrawable > 0) {
            if (stream.token == AddressHelper.ethAddress()) {
                stream.recipient.safeTransferEther(withdrawable);
            } else {
                stream.token.safeTransfer(stream.recipient, withdrawable);
            }
        }

        if (remaining > 0) {
            if (stream.token == AddressHelper.ethAddress()) {
                stream.sender.safeTransferEther(remaining);
            } else {
                stream.token.safeTransfer(stream.sender, remaining);
            }
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
}
