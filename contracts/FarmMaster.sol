pragma solidity 0.5.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./XDEX.sol";
import "./XStream.sol";

// FarmMaster is the master of xDefi Farms.
contract FarmMaster is ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 constant ONE = 10**18;
    uint256 constant onePercent = 10**16;
    uint256 constant StreamTypeVoting = 0;
    uint256 constant StreamTypeNormal = 1;

    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
        //
        // We do some fancy math here. Basically, any point in time, the amount of XDEX
        // entitled to a user but is pending to be distributed is:
        //
        //   pending reward = (user.amount * pool.accXDEXPerShare) - user.rewardDebt
        //
        // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
        //   1. The pool's `accXDEXPerShare` (and `lastRewardBlock`) gets updated.
        //   2. User receives the pending reward sent to his/her address.
        //   3. User's `amount` gets updated.
        //   4. User's `rewardDebt` gets updated.
    }

    struct LpTokenInfo {
        IERC20 lpToken; // Address of LP token contract.
        // lpTokenType, Type of LP token
        //      Type0: XPT;
        //      Type1: UNI-LP;
        //      Type2: BPT;
        //      Type3: XLP;
        //      Type4: yCrv;
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

    /*
        1-40000块 分发14400 每1块增发360个
        40001-120000块 分发14400 每块分发180个
        120001-280000块 分发14400 每块分发90个
        280001-600000块 分发14400 每块分发45个
        从600000后，每1块常量量分发10个
    */
    uint256[4] public bonusEndBlocks = [40000, 120000, 280000, 600000];

    //360, 180, 90, 45, 10 xdexPerBlock
    uint256[5] public tokensPerBlock = [
        uint256(360 * ONE),
        180 * ONE,
        90 * ONE,
        45 * ONE,
        10 * ONE
    ];

    //首次入金激励(每用户一次)
    uint256 constant bonusFirstDeposit = 10 * ONE;

    address public core;

    // The XDEX TOKEN
    XDEX public xdex;

    // The Halflife Protocol
    XStream public stream;

    // The main voting pool id
    uint256 public votingPoolId;

    // The block number when Token farming starts.
    uint256 public startBlock;

    // Info of each pool.
    PoolInfo[] public poolInfo;

    // Total allocation poitns. Must be the sum of all allocation points in all pools.
    uint256 public totalXFactor = 0;

    event AddPool(
        uint256 indexed pid,
        address indexed lpToken,
        uint256 indexed lpType,
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

    event CoreTransferred(address indexed _core, address indexed _coreNew);

    /**
     * @dev Throws if the msg.sender unauthorized.
     */
    modifier onlyCore() {
        require(msg.sender == core, "Not authorized, only core");
        _;
    }

    /**
     * @dev Throws if the pid does not point to a valid pool.
     */
    modifier poolExists(uint256 _pid) {
        require(_pid < poolInfo.length, "pool does not exist");
        _;
    }

    constructor(
        XDEX _xdex,
        XStream _stream,
        uint256 _startBlock,
        address _core
    ) public {
        xdex = _xdex;
        stream = _stream;
        startBlock = _startBlock;
        core = _core;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Set the voting pool id. Can only be called by the core.
    function setVotingPool(uint256 _pid) public onlyCore {
        votingPoolId = _pid;
    }

    // Add a new lp to the pool. Can only be called by the core.
    // DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function addPool(
        IERC20 _lpToken,
        uint256 _lpTokenType,
        uint256 _lpFactor,
        bool _withUpdate
    ) public onlyCore {
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 _lastRewardBlock = block.number > startBlock
            ? block.number
            : startBlock;

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

        emit AddPool(poolinfos_id, address(_lpToken), _lpTokenType, _lpFactor);
    }

    function addLpTokenToPool(
        uint256 _pid,
        IERC20 _lpToken,
        uint256 _lpTokenType,
        uint256 _lpFactor
    ) public onlyCore poolExists(_pid) {
        massUpdatePools();

        PoolInfo memory pool = poolInfo[_pid];
        for (uint256 i = 0; i < pool.LpTokenInfos.length; i++) {
            require(
                _lpToken != pool.LpTokenInfos[i].lpToken,
                "lp token already added"
            );
        }

        totalXFactor = totalXFactor.add(_lpFactor);

        LpTokenInfo memory lpTokenInfo = LpTokenInfo({
            lpToken: _lpToken,
            lpTokenType: _lpTokenType,
            lpFactor: _lpFactor,
            lpAccPerShare: 0
        });
        poolInfo[_pid].poolFactor = pool.poolFactor.add(_lpFactor);
        poolInfo[_pid].LpTokenInfos.push(lpTokenInfo);
    }

    // Update the given lpToken's lpFactor in the given pool. Can only be called by the owner.
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

        bool found = false;
        uint256 index = 0;
        for (uint256 i = 0; i < pool.LpTokenInfos.length; i++) {
            if (_lpToken == pool.LpTokenInfos[i].lpToken) {
                found = true;
                index = i;
                break;
            }
        }

        //update poolFactor and totalXFactor
        uint256 poolFactorNew = pool
            .poolFactor
            .sub(pool.LpTokenInfos[index].lpFactor)
            .add(_lpFactor);
        pool.LpTokenInfos[index].lpFactor = _lpFactor;

        totalXFactor = totalXFactor.sub(poolInfo[_pid].poolFactor).add(
            poolFactorNew
        );
        poolInfo[_pid].poolFactor = poolFactorNew;
    }

    // Update reward variables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public poolExists(_pid) {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }

        (uint256 poolReward, , ) = getXCountToReward(
            pool.lastRewardBlock,
            block.number
        );
        poolReward = poolReward.mul(pool.poolFactor).div(totalXFactor);

        uint256 totalLpSupply = 0;
        for (uint256 i = 0; i < pool.LpTokenInfos.length; i++) {
            LpTokenInfo memory lpInfo = pool.LpTokenInfos[i];
            uint256 lpSupply = lpInfo.lpToken.balanceOf(address(this));
            if (lpSupply == 0) {
                continue;
            }
            totalLpSupply = totalLpSupply.add(lpSupply);
            uint256 lpReward = poolReward.mul(lpInfo.lpFactor).div(
                pool.poolFactor
            );
            pool.LpTokenInfos[i].lpAccPerShare = lpInfo.lpAccPerShare.add(
                lpReward.mul(1e12).div(lpSupply)
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
        returns (uint256)
    {
        PoolInfo memory pool = poolInfo[_pid];

        uint256 totalPending = 0;

        (uint256 xdexReward, , ) = getXCountToReward(
            pool.lastRewardBlock,
            block.number
        );
        uint256 poolReward = xdexReward.mul(pool.poolFactor).div(totalXFactor);

        for (uint256 i = 0; i < pool.LpTokenInfos.length; i++) {
            LpTokenInfo memory lpInfo = pool.LpTokenInfos[i];
            uint256 lpSupply = lpInfo.lpToken.balanceOf(address(this));
            if (lpSupply == 0) {
                continue;
            }
            if (block.number > pool.lastRewardBlock) {
                uint256 lpReward = poolReward.mul(lpInfo.lpFactor).div(
                    pool.poolFactor
                );
                lpInfo.lpAccPerShare = lpInfo.lpAccPerShare.add(
                    lpReward.mul(1e12).div(lpSupply)
                );
            }
            UserInfo memory user = poolInfo[_pid].LpTokenInfos[i]
                .userInfo[_user];
            totalPending = totalPending.add(
                user.amount.mul(lpInfo.lpAccPerShare).div(1e12).sub(
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
    ) public poolExists(_pid) {
        //require(_isContract(msg.sender), "deposit addr should not contract");
        require(msg.sender == tx.origin, "do not deposit from contract");

        PoolInfo storage pool = poolInfo[_pid];

        bool found = false;
        uint256 index = 0;
        for (uint256 i = 0; i < pool.LpTokenInfos.length; i++) {
            if (_lpToken == pool.LpTokenInfos[i].lpToken) {
                found = true;
                index = i;
                break;
            }
        }

        require(found, "deposit the lp token which not exist");

        updatePool(_pid);

        UserInfo storage user = poolInfo[_pid].LpTokenInfos[index].userInfo[msg
            .sender];

        if (user.amount > 0) {
            uint256 pending = user
                .amount
                .mul(pool.LpTokenInfos[index].lpAccPerShare)
                .div(1e12)
                .sub(user.rewardDebt);

            if (pending > 0) {
                //create the stream or add funds to stream
                (bool hasVotingStream, bool hasNormalStream) = stream.hasStream(
                    msg.sender
                );

                if (_pid == votingPoolId) {
                    if (hasVotingStream) {
                        //add funds
                        uint256 streamId = stream.getStreamId(
                            msg.sender,
                            StreamTypeVoting
                        );
                        require(streamId > 0, "not valid stream id");

                        xdex.approve(address(stream), pending);
                        stream.fundsToStream(streamId, pending);
                    }
                } else {
                    if (hasNormalStream) {
                        //add funds
                        uint256 streamId = stream.getStreamId(
                            msg.sender,
                            StreamTypeNormal
                        );
                        require(streamId > 0, "not valid stream id");

                        xdex.approve(address(stream), pending);
                        stream.fundsToStream(streamId, pending);
                    }
                }
            }
        } else {
            if (block.number >= startBlock) {
                //if it is the first deposit
                (bool hasVotingStream, bool hasNormalStream) = stream.hasStream(
                    msg.sender
                );

                //create the stream
                if (_pid == votingPoolId) {
                    if (hasVotingStream == false) {
                        xdex.mint(address(this), bonusFirstDeposit);
                        xdex.approve(address(stream), bonusFirstDeposit);
                        stream.createStream(
                            msg.sender,
                            bonusFirstDeposit,
                            StreamTypeVoting,
                            block.number + 1
                        );
                    }
                } else {
                    if (hasNormalStream == false) {
                        xdex.mint(address(this), bonusFirstDeposit);
                        xdex.approve(address(stream), bonusFirstDeposit);
                        stream.createStream(
                            msg.sender,
                            bonusFirstDeposit,
                            StreamTypeNormal,
                            block.number + 1
                        );
                    }
                }
            }
        }

        if (_amount > 0) {
            pool.LpTokenInfos[index].lpToken.safeTransferFrom(
                address(msg.sender),
                address(this),
                _amount
            );
            user.amount = user.amount.add(_amount);
        }

        user.rewardDebt = user
            .amount
            .mul(pool.LpTokenInfos[index].lpAccPerShare)
            .div(1e12);

        emit Deposit(msg.sender, _pid, address(_lpToken), _amount);
    }

    // Withdraw LP tokens from MasterChef.
    function withdraw(
        uint256 _pid,
        IERC20 _lpToken,
        uint256 _amount
    ) public nonReentrant poolExists(_pid) {
        //require(_isContract(msg.sender), "deposit addr should not contract");

        PoolInfo storage pool = poolInfo[_pid];

        bool found = false;
        uint256 index = 0;
        for (uint256 i = 0; i < pool.LpTokenInfos.length; i++) {
            if (_lpToken == pool.LpTokenInfos[i].lpToken) {
                found = true;
                index = i;
                break;
            }
        }

        require(found, "deposit the lp token which not exist");

        updatePool(_pid);

        UserInfo storage user = poolInfo[_pid].LpTokenInfos[index].userInfo[msg
            .sender];
        require(user.amount >= _amount, "withdraw: _amount not good");

        uint256 pending = user
            .amount
            .mul(pool.LpTokenInfos[index].lpAccPerShare)
            .div(1e12)
            .sub(user.rewardDebt);

        if (pending > 0) {
            //create the stream or add funds to stream
            (bool hasVotingStream, bool hasNormalStream) = stream.hasStream(
                msg.sender
            );

            /* Approve the Stream contract to spend. */
            xdex.approve(address(stream), pending);

            if (_pid == votingPoolId) {
                if (hasVotingStream) {
                    //add fund
                    uint256 streamId = stream.getStreamId(
                        msg.sender,
                        StreamTypeVoting
                    );
                    require(streamId > 0, "not valid stream id");

                    xdex.approve(address(stream), pending);
                    stream.fundsToStream(streamId, pending);
                }
            } else {
                if (hasNormalStream) {
                    //add fund
                    uint256 streamId = stream.getStreamId(
                        msg.sender,
                        StreamTypeNormal
                    );
                    require(streamId > 0, "not valid stream id");

                    xdex.approve(address(stream), pending);
                    stream.fundsToStream(streamId, pending);
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
            .div(1e12);

        emit Withdraw(msg.sender, _pid, address(_lpToken), _amount);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid)
        public
        nonReentrant
        poolExists(_pid)
    {
        PoolInfo storage pool = poolInfo[_pid];

        for (uint256 i = 0; i < pool.LpTokenInfos.length; i++) {
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

    function getXCountToReward(uint256 _from, uint256 _to)
        public
        view
        returns (
            uint256 _totalReward,
            uint256 _stageFrom,
            uint256 _stageTo
        )
    {
        require(_from <= _to, "_from must >= _to");

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
                stageFrom,
                stageTo
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

    function getCurRewardPerBlock() public view returns (uint256) {
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
            if (bnum > actualEndBlock) {
                stage = stage.add(1);
            }
        }

        require(
            stage >= 0 && stage < tokensPerBlock.length,
            "tokensPerBlock.length: not good"
        );
        return tokensPerBlock[stage];
    }

    // Safe xdex transfer function, just in case if rounding error causes pool to not have enough XDEX.
    // function _safeXDexTransfer(address _to, uint256 _amount) internal {
    //     uint256 xdexBal = xdex.balanceOf(address(this));
    //     if (_amount > xdexBal) {
    //         xdex.transfer(_to, xdexBal);
    //     } else {
    //         xdex.transfer(_to, _amount);
    //     }
    // }

    function setCore(address _core) public onlyCore {
        emit CoreTransferred(core, _core);
        core = _core;
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
