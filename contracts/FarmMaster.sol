pragma solidity 0.5.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./XDEX.sol";
import "./XdexStream.sol";

// FarmMaster is the master of xDefi Farms.
contract FarmMaster is ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 private constant ONE = 10**18;
    uint256 private constant StreamTypeVoting = 0;
    uint256 private constant StreamTypeNormal = 1;

    //min and max lpToken count in one pool
    uint256 private constant LpTokenMinCount = 1;
    uint256 private constant LpTokenMaxCount = 8;

    uint256 private constant LpRewardFixDec = 1e12;

    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt.
    }

    struct LpTokenInfo {
        IERC20 lpToken; // Address of LP token contract.
        // lpTokenType, Type of LP token
        //      Type0: XPT;
        //      Type1: UNI-LP;
        //      Type2: BPT;
        //      Type3: XLP;
        uint256 lpTokenType;
        uint256 lpFactor;
        uint256 lpAccPerShare; // Accumulated XDEX per share, times 1e12. See below.
        mapping(address => UserInfo) userInfo; // Info of each user that stakes LP tokens.
    }

    // Info of each pool.
    struct PoolInfo {
        LpTokenInfo[] LpTokenInfos;
        uint256 poolFactor; // How many allocation factor assigned to this pool. XDEX to distribute per block.
        uint256 lastRewardBlock; // Last block number that XDEX distribution occurs.
    }

    //key: hash(pid + lp address), value: index
    mapping(bytes32 => uint256) private lpIndexInPool;

    /*
     * In [0, 60000) blocks, 160 XDEX per block, 9600000 XDEX distributed;
     * In [60000, 180000) blocks, 80 XDEX per block, 9600000 XDEX distributed;
     * In [180000, 420000) blocks, 40 XDEX per block, 9600000 XDEX distributed;
     * In [420000, 900000) blocks, 20 XDEX per block, 9600000 XDEX distributed;
     * After 900000 blocks, 8 XDEX distributed per block.
     */
    uint256[4] public bonusEndBlocks = [60000, 180000, 420000, 900000];

    // 160, 80, 40, 20, 8 XDEX per block
    uint256[5] public tokensPerBlock = [
        uint256(160 * ONE),
        uint256(80 * ONE),
        uint256(40 * ONE),
        uint256(20 * ONE),
        uint256(8 * ONE)
    ];

    // First deposit incentive (once for each new user): 10 XDEX
    uint256 public constant bonusFirstDeposit = 10 * ONE;

    address public core;
    // The XDEX TOKEN
    XDEX public xdex;

    // Secure Asset Fund for Users(SAFU) address, same as SAFU in xdefi-base/contracts/XConfig.sol
    address public safu;

    // whitelist of claimable airdrop tokens
    mapping(address => bool) public claimableTokens;

    // The Halflife Proxy Contract
    XdexStream public stream;

    // The main voting pool id
    uint256 public votingPoolId;

    // The block number when Token farming starts.
    uint256 public startBlock;

    // Info of each pool.
    PoolInfo[] public poolInfo;

    // Total allocation factors. Must be the sum of all allocation factors in all pools.
    uint256 public totalXFactor = 0;

    event AddPool(
        uint256 indexed pid,
        address indexed lpToken,
        uint256 indexed lpType,
        uint256 lpFactor
    );

    event AddLP(
        uint256 indexed pid,
        address indexed lpToken,
        uint256 indexed lpType,
        uint256 lpFactor
    );

    event UpdateFactor(
        uint256 indexed pid,
        address indexed lpToken,
        uint256 lpFactor
    );

    event Deposit(
        address indexed user,
        uint256 indexed pid,
        address indexed lpToken,
        uint256 amount
    );

    event Withdraw(
        address indexed user,
        uint256 indexed pid,
        address indexed lpToken,
        uint256 amount
    );

    event EmergencyWithdraw(
        address indexed user,
        uint256 indexed pid,
        address indexed lpToken,
        uint256 amount
    );

    event Claim(
        address indexed to,
        address indexed token,
        uint256 indexed amount
    );

    event SetCore(address indexed _core, address indexed _coreNew);
    event SetStream(address indexed _stream, address indexed _streamNew);
    event SetVotingPool(uint256 indexed _pid);

    /**
     * @dev Throws if the msg.sender unauthorized.
     */
    modifier onlyCore() {
        require(msg.sender == core, "Not authorized");
        _;
    }

    /**
     * @dev Throws if the pid does not point to a valid pool.
     */
    modifier poolExists(uint256 _pid) {
        require(_pid < poolInfo.length, "pool not exist");
        _;
    }

    constructor(
        XDEX _xdex,
        uint256 _startBlock,
        address _safu
    ) public {
        require(_safu != address(0), "ERR_ZERO_ADDRESS");

        xdex = _xdex;
        startBlock = _startBlock;
        core = msg.sender;
        safu = _safu;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Set the voting pool id.
    function setVotingPool(uint256 _pid) external onlyCore {
        votingPoolId = _pid;
        emit SetVotingPool(_pid);
    }

    // Set the xdex stream proxy.
    function setStream(address _stream) external onlyCore {
        require(_stream != address(0), "ERR_ZERO_ADDRESS");
        emit SetStream(address(stream), _stream);
        stream = XdexStream(_stream);
    }

    // Set new core
    function setCore(address _core) external onlyCore {
        require(_core != address(0), "ERR_ZERO_ADDRESS");
        emit SetCore(core, _core);
        core = _core;
    }

    // Add a new lp to the pool. Can only be called by the core.
    // DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function addPool(
        IERC20 _lpToken,
        uint256 _lpTokenType,
        uint256 _lpFactor,
        bool _withUpdate
    ) external onlyCore {
        require(_lpFactor > 0, "Lp Token Factor is zero");

        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 _lastRewardBlock =
            block.number > startBlock ? block.number : startBlock;

        totalXFactor = totalXFactor.add(_lpFactor);

        uint256 poolinfos_id = poolInfo.length++;
        poolInfo[poolinfos_id].poolFactor = _lpFactor;
        poolInfo[poolinfos_id].lastRewardBlock = _lastRewardBlock;
        poolInfo[poolinfos_id].LpTokenInfos.push(
            LpTokenInfo({
                lpToken: _lpToken,
                lpTokenType: _lpTokenType,
                lpFactor: _lpFactor,
                lpAccPerShare: 0
            })
        );
        //The index in storage starts with 1, then need sub(1)
        lpIndexInPool[keccak256(abi.encodePacked(poolinfos_id, _lpToken))] = 1;
        emit AddPool(poolinfos_id, address(_lpToken), _lpTokenType, _lpFactor);
    }

    function addLpTokenToPool(
        uint256 _pid,
        IERC20 _lpToken,
        uint256 _lpTokenType,
        uint256 _lpFactor
    ) public onlyCore poolExists(_pid) {
        require(_lpFactor > 0, "Lp Token Factor is zero");

        massUpdatePools();

        PoolInfo memory pool = poolInfo[_pid];
        require(
            lpIndexInPool[keccak256(abi.encodePacked(_pid, _lpToken))] == 0,
            "lp token already added"
        );

        //check lpToken count
        uint256 count = pool.LpTokenInfos.length;
        require(
            count >= LpTokenMinCount && count < LpTokenMaxCount,
            "pool lpToken length is bad"
        );

        totalXFactor = totalXFactor.add(_lpFactor);

        LpTokenInfo memory lpTokenInfo =
            LpTokenInfo({
                lpToken: _lpToken,
                lpTokenType: _lpTokenType,
                lpFactor: _lpFactor,
                lpAccPerShare: 0
            });
        poolInfo[_pid].poolFactor = pool.poolFactor.add(_lpFactor);
        poolInfo[_pid].LpTokenInfos.push(lpTokenInfo);

        //save lpToken index
        //The index in storage starts with 1, then need sub(1)
        lpIndexInPool[keccak256(abi.encodePacked(_pid, _lpToken))] = count + 1;

        emit AddLP(_pid, address(_lpToken), _lpTokenType, _lpFactor);
    }

    function getLpTokenInfosByPoolId(uint256 _pid)
        external
        view
        poolExists(_pid)
        returns (
            address[] memory lpTokens,
            uint256[] memory lpTokenTypes,
            uint256[] memory lpFactors,
            uint256[] memory lpAccPerShares
        )
    {
        PoolInfo memory pool = poolInfo[_pid];
        uint256 length = pool.LpTokenInfos.length;
        lpTokens = new address[](length);
        lpTokenTypes = new uint256[](length);
        lpFactors = new uint256[](length);
        lpAccPerShares = new uint256[](length);
        for (uint8 i = 0; i < length; i++) {
            lpTokens[i] = address(pool.LpTokenInfos[i].lpToken);
            lpTokenTypes[i] = pool.LpTokenInfos[i].lpTokenType;
            lpFactors[i] = pool.LpTokenInfos[i].lpFactor;
            lpAccPerShares[i] = pool.LpTokenInfos[i].lpAccPerShare;
        }
    }

    // Update the given lpToken's lpFactor in the given pool. Can only be called by the owner.
    // `_lpFactor` is 0, means the LpToken is soft deleted from pool.
    function setLpFactor(
        uint256 _pid,
        IERC20 _lpToken,
        uint256 _lpFactor,
        bool _withUpdate
    ) public onlyCore poolExists(_pid) {
        if (_withUpdate) {
            massUpdatePools();
        }

        PoolInfo storage pool = poolInfo[_pid];
        uint256 index = _getLpIndexInPool(_pid, _lpToken);
        //update poolFactor and totalXFactor
        uint256 poolFactorNew =
            pool.poolFactor.sub(pool.LpTokenInfos[index].lpFactor).add(
                _lpFactor
            );
        pool.LpTokenInfos[index].lpFactor = _lpFactor;

        totalXFactor = totalXFactor.sub(poolInfo[_pid].poolFactor).add(
            poolFactorNew
        );
        poolInfo[_pid].poolFactor = poolFactorNew;

        emit UpdateFactor(_pid, address(_lpToken), _lpFactor);
    }

    // Update reward variables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint8 pid = 0; pid < length; ++pid) {
            if (poolInfo[pid].poolFactor > 0) {
                updatePool(pid);
            }
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public poolExists(_pid) {
        if (block.number <= poolInfo[_pid].lastRewardBlock) {
            return;
        }

        if (poolInfo[_pid].poolFactor == 0 || totalXFactor == 0) {
            return;
        }

        PoolInfo storage pool = poolInfo[_pid];
        (uint256 poolReward, , ) =
            getXCountToReward(pool.lastRewardBlock, block.number);
        poolReward = poolReward.mul(pool.poolFactor).div(totalXFactor);

        uint256 totalLpSupply = 0;
        for (uint8 i = 0; i < pool.LpTokenInfos.length; i++) {
            LpTokenInfo memory lpInfo = pool.LpTokenInfos[i];
            uint256 lpSupply = lpInfo.lpToken.balanceOf(address(this));
            if (lpSupply == 0) {
                continue;
            }
            totalLpSupply = totalLpSupply.add(lpSupply);
            uint256 lpReward =
                poolReward.mul(lpInfo.lpFactor).div(pool.poolFactor);
            pool.LpTokenInfos[i].lpAccPerShare = lpInfo.lpAccPerShare.add(
                lpReward.mul(LpRewardFixDec).div(lpSupply)
            );
        }

        if (totalLpSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }

        xdex.mint(address(this), poolReward);
        pool.lastRewardBlock = block.number;
    }

    // View function to see pending XDEX on frontend.
    function pendingXDEX(uint256 _pid, address _user)
        external
        view
        poolExists(_pid)
        returns (uint256)
    {
        PoolInfo memory pool = poolInfo[_pid];

        uint256 totalPending = 0;
        if (totalXFactor == 0 || pool.poolFactor == 0) {
            for (uint8 i = 0; i < pool.LpTokenInfos.length; i++) {
                UserInfo memory user =
                    poolInfo[_pid].LpTokenInfos[i].userInfo[_user];
                totalPending = totalPending.add(
                    user
                        .amount
                        .mul(pool.LpTokenInfos[i].lpAccPerShare)
                        .div(LpRewardFixDec)
                        .sub(user.rewardDebt)
                );
            }

            return totalPending;
        }

        (uint256 xdexReward, , ) =
            getXCountToReward(pool.lastRewardBlock, block.number);

        uint256 poolReward = xdexReward.mul(pool.poolFactor).div(totalXFactor);

        for (uint8 i = 0; i < pool.LpTokenInfos.length; i++) {
            LpTokenInfo memory lpInfo = pool.LpTokenInfos[i];
            uint256 lpSupply = lpInfo.lpToken.balanceOf(address(this));
            if (lpSupply == 0) {
                continue;
            }
            if (block.number > pool.lastRewardBlock) {
                uint256 lpReward =
                    poolReward.mul(lpInfo.lpFactor).div(pool.poolFactor);
                lpInfo.lpAccPerShare = lpInfo.lpAccPerShare.add(
                    lpReward.mul(LpRewardFixDec).div(lpSupply)
                );
            }
            UserInfo memory user =
                poolInfo[_pid].LpTokenInfos[i].userInfo[_user];
            totalPending = totalPending.add(
                user.amount.mul(lpInfo.lpAccPerShare).div(LpRewardFixDec).sub(
                    user.rewardDebt
                )
            );
        }

        return totalPending;
    }

    // Deposit LP tokens to FarmMaster for XDEX allocation.
    function deposit(
        uint256 _pid,
        IERC20 _lpToken,
        uint256 _amount
    ) external poolExists(_pid) {
        require(_amount > 0, "not valid amount");

        PoolInfo storage pool = poolInfo[_pid];
        uint256 index = _getLpIndexInPool(_pid, _lpToken);
        uint256 blockHeightDiff = block.number.sub(pool.lastRewardBlock);

        require(index < poolInfo[_pid].LpTokenInfos.length, "not valid index");

        updatePool(_pid);

        UserInfo storage user =
            poolInfo[_pid].LpTokenInfos[index].userInfo[msg.sender];

        if (user.amount > 0) {
            uint256 pending =
                user
                    .amount
                    .mul(pool.LpTokenInfos[index].lpAccPerShare)
                    .div(LpRewardFixDec)
                    .sub(user.rewardDebt);

            if (pending > 0) {
                //create the stream or add funds to stream
                (bool hasVotingStream, bool hasNormalStream) =
                    stream.hasStream(msg.sender);

                if (_pid == votingPoolId) {
                    if (hasVotingStream) {
                        //add funds
                        uint256 streamId =
                            stream.getStreamId(msg.sender, StreamTypeVoting);
                        require(streamId > 0, "not valid stream id");

                        xdex.approve(address(stream), pending);
                        stream.fundsToStream(
                            streamId,
                            pending,
                            blockHeightDiff
                        );
                    }
                } else {
                    if (hasNormalStream) {
                        //add funds
                        uint256 streamId =
                            stream.getStreamId(msg.sender, StreamTypeNormal);
                        require(streamId > 0, "not valid stream id");

                        xdex.approve(address(stream), pending);
                        stream.fundsToStream(
                            streamId,
                            pending,
                            blockHeightDiff
                        );
                    }
                }
            }
        } else {
            uint256 streamStart = block.number + 1;
            if (block.number < startBlock) {
                streamStart = startBlock;
            }

            //if it is the first deposit
            (bool hasVotingStream, bool hasNormalStream) =
                stream.hasStream(msg.sender);

            //create the stream for First Deposit Bonus
            if (_pid == votingPoolId) {
                if (!hasVotingStream) {
                    xdex.mint(address(this), bonusFirstDeposit);
                    xdex.approve(address(stream), bonusFirstDeposit);
                    stream.createStream(
                        msg.sender,
                        bonusFirstDeposit,
                        StreamTypeVoting,
                        streamStart
                    );
                }
            } else {
                if (!hasNormalStream) {
                    xdex.mint(address(this), bonusFirstDeposit);
                    xdex.approve(address(stream), bonusFirstDeposit);
                    stream.createStream(
                        msg.sender,
                        bonusFirstDeposit,
                        StreamTypeNormal,
                        streamStart
                    );
                }
            }
        }

        pool.LpTokenInfos[index].lpToken.safeTransferFrom(
            address(msg.sender),
            address(this),
            _amount
        );
        user.amount = user.amount.add(_amount);

        user.rewardDebt = user
            .amount
            .mul(pool.LpTokenInfos[index].lpAccPerShare)
            .div(LpRewardFixDec);

        emit Deposit(msg.sender, _pid, address(_lpToken), _amount);
    }

    function withdraw(
        uint256 _pid,
        IERC20 _lpToken,
        uint256 _amount
    ) public poolExists(_pid) {
        PoolInfo storage pool = poolInfo[_pid];
        uint256 index = _getLpIndexInPool(_pid, _lpToken);
        require(index < poolInfo[_pid].LpTokenInfos.length, "not valid index");
        uint256 blockHeightDiff = block.number.sub(pool.lastRewardBlock);

        updatePool(_pid);

        UserInfo storage user =
            poolInfo[_pid].LpTokenInfos[index].userInfo[msg.sender];
        require(user.amount >= _amount, "withdraw: _amount not good");

        uint256 pending =
            user
                .amount
                .mul(pool.LpTokenInfos[index].lpAccPerShare)
                .div(LpRewardFixDec)
                .sub(user.rewardDebt);

        if (pending > 0) {
            //create the stream or add funds to stream
            (bool hasVotingStream, bool hasNormalStream) =
                stream.hasStream(msg.sender);

            /* Approve the Stream contract to spend. */
            xdex.approve(address(stream), pending);

            if (_pid == votingPoolId) {
                if (hasVotingStream) {
                    //add fund
                    uint256 streamId =
                        stream.getStreamId(msg.sender, StreamTypeVoting);
                    require(streamId > 0, "not valid stream id");

                    xdex.approve(address(stream), pending);
                    stream.fundsToStream(streamId, pending, blockHeightDiff);
                }
            } else {
                if (hasNormalStream) {
                    //add fund
                    uint256 streamId =
                        stream.getStreamId(msg.sender, StreamTypeNormal);
                    require(streamId > 0, "not valid stream id");

                    xdex.approve(address(stream), pending);
                    stream.fundsToStream(streamId, pending, blockHeightDiff);
                }
            }
        }
        if (_amount > 0) {
            user.amount = user.amount.sub(_amount);
            pool.LpTokenInfos[index].lpToken.safeTransfer(
                address(msg.sender),
                _amount
            );
        }
        user.rewardDebt = user
            .amount
            .mul(pool.LpTokenInfos[index].lpAccPerShare)
            .div(LpRewardFixDec);

        emit Withdraw(msg.sender, _pid, address(_lpToken), _amount);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid)
        external
        nonReentrant
        poolExists(_pid)
    {
        PoolInfo storage pool = poolInfo[_pid];

        for (uint8 i = 0; i < pool.LpTokenInfos.length; i++) {
            LpTokenInfo storage lpInfo = pool.LpTokenInfos[i];
            UserInfo storage user = lpInfo.userInfo[msg.sender];

            if (user.amount > 0) {
                lpInfo.lpToken.safeTransfer(address(msg.sender), user.amount);

                emit EmergencyWithdraw(
                    msg.sender,
                    _pid,
                    address(lpInfo.lpToken),
                    user.amount
                );
                user.amount = 0;
                user.rewardDebt = 0;
            }
        }
    }

    // Batch collect function in pool on frontend
    function batchCollectReward(uint256 _pid) external poolExists(_pid) {
        PoolInfo storage pool = poolInfo[_pid];
        uint256 length = pool.LpTokenInfos.length;

        for (uint8 i = 0; i < length; i++) {
            IERC20 lpToken = pool.LpTokenInfos[i].lpToken;
            UserInfo storage user = pool.LpTokenInfos[i].userInfo[msg.sender];
            if (user.amount > 0) {
                //collect
                withdraw(_pid, lpToken, 0);
            }
        }
    }

    // View function to see user lpToken amount in pool on frontend.
    function getUserLpAmounts(uint256 _pid, address _user)
        external
        view
        poolExists(_pid)
        returns (address[] memory lpTokens, uint256[] memory amounts)
    {
        PoolInfo memory pool = poolInfo[_pid];
        uint256 length = pool.LpTokenInfos.length;
        lpTokens = new address[](length);
        amounts = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            lpTokens[i] = address(pool.LpTokenInfos[i].lpToken);
            UserInfo memory user =
                poolInfo[_pid].LpTokenInfos[i].userInfo[_user];
            amounts[i] = user.amount;
        }
    }

    function getXCountToReward(uint256 _from, uint256 _to)
        public
        view
        returns (
            uint256 _totalReward,
            uint256 _stageFrom,
            uint256 _stageTo
        )
    {
        require(_from <= _to, "_from must <= _to");

        uint256 stageFrom = 0;
        uint256 stageTo = 0;

        if (_to < startBlock) {
            return (0, stageFrom, stageTo);
        }

        if (
            _from >= startBlock.add(bonusEndBlocks[bonusEndBlocks.length - 1])
        ) {
            return (
                _to.sub(_from).mul(tokensPerBlock[tokensPerBlock.length - 1]),
                bonusEndBlocks.length + 1,
                bonusEndBlocks.length + 1
            );
        }

        uint256 total = 0;

        for (uint256 i = 0; i < bonusEndBlocks.length; i++) {
            uint256 actualEndBlock = startBlock.add(bonusEndBlocks[i]);
            if (_from > actualEndBlock) {
                stageFrom = stageFrom.add(1);
            }
            if (_to > actualEndBlock) {
                stageTo = stageTo.add(1);
            }
        }

        uint256 tStageFrom = stageFrom;
        while (_from < _to) {
            if (_from < startBlock) {
                _from = startBlock;
            }
            uint256 indexDiff = stageTo.sub(tStageFrom);
            if (indexDiff == 0) {
                total += (_to - _from) * tokensPerBlock[tStageFrom];
                _from = _to;
                break;
            } else if (indexDiff > 0) {
                uint256 actualRes = startBlock.add(bonusEndBlocks[tStageFrom]);
                total += (actualRes - _from) * tokensPerBlock[tStageFrom];
                _from = actualRes;
                tStageFrom = tStageFrom.add(1);
            } else {
                //this never happen
                break;
            }
        }

        return (total, stageFrom, stageTo);
    }

    function getCurRewardPerBlock() external view returns (uint256) {
        uint256 bnum = block.number;
        if (bnum < startBlock) {
            return 0;
        }
        if (bnum >= startBlock.add(bonusEndBlocks[bonusEndBlocks.length - 1])) {
            return tokensPerBlock[tokensPerBlock.length - 1];
        }
        uint256 stage = 0;
        for (uint256 i = 0; i < bonusEndBlocks.length; i++) {
            uint256 actualEndBlock = startBlock.add(bonusEndBlocks[i]);
            if (bnum >= actualEndBlock) {
                stage = stage.add(1);
            }
        }

        require(
            stage >= 0 && stage < tokensPerBlock.length,
            "tokensPerBlock length not good"
        );
        return tokensPerBlock[stage];
    }

    // Any airdrop tokens (in whitelist) sent to this contract, should transfer to safu
    function claimRewards(address token, uint256 amount) external onlyCore {
        require(claimableTokens[token], "not claimable token");

        IERC20(token).safeTransfer(safu, amount);
        emit Claim(core, token, amount);
    }

    function updateClaimableTokens(address token, bool claimable)
        external
        onlyCore
    {
        claimableTokens[token] = claimable;
    }

    // The index in storage starts with 1, then need sub(1)
    function _getLpIndexInPool(uint256 _pid, IERC20 _lpToken)
        internal
        view
        returns (uint256)
    {
        uint256 index =
            lpIndexInPool[keccak256(abi.encodePacked(_pid, _lpToken))];
        require(index > 0, "deposit the lp token which not exist");
        return --index;
    }
}
