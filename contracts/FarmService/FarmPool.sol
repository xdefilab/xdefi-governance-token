pragma solidity 0.5.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./IXHalfLife.sol";

// Farm Pool Service
contract FarmPool is ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 constant ONE = 10**18;
    uint256 constant onePercent = 10**16;

    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt.
        bool isEntity;
    }

    struct PoolInfo {
        IERC20 lpToken;
        uint256 lastRewardBlock; // Last block number that token distribution occurs.
        uint256 lpAccPerShare;
        mapping(address => UserInfo) userInfo;
    }

    address public controller;

    IERC20 public rewardToken;
    uint256 public rewardAmount;

    // The Halflife Protocol
    IXHalfLife public stream;

    uint256 public startBlock;
    uint256 public stopBlock;

    PoolInfo public poolInfo;

    event Deposit(address indexed user, uint256 amount);

    event Withdraw(address indexed user, uint256 amount);

    event EmergencyWithdraw(address indexed user, uint256 amount);

    event CoreTransferred(address indexed _core, address indexed _coreNew);

    /**
     * @dev Throws if the msg.sender unauthorized.
     */
    modifier onlyController() {
        require(msg.sender == controller, "Not controller");
        _;
    }

    constructor(
        IERC20 _rewardToken,
        uint256 _rewardAmount,
        address _stream,
        uint256 _startBlock,
        uint256 _stopBlock,
        address _controller
    ) public {
        token = _token;
        stream = IXHalfLife(_stream);
        startBlock = _startBlock;
        stopBlock = _stopBlock;
        controller = _controller;
    }

    function initPool(IERC20 _lpToken) public onlyController {
        poolInfo.lpToken = _lpToken;
        poolInfo.lastRewardBlock = 0;
        poolInfo.lpAccPerShare = 0;
    }

    function getPoolInfo()
        public
        view
        returns (
            address lpToken,
            uint256 lpAccPerShare,
            uint256 lastRewardBlock
        )
    {
        return (
            poolInfo.lpToken,
            poolInfo.lpAccPerShare,
            poolInfo.lastRewardBlock
        );
    }

    // View function to see user lpToken amount in pool on frontend.
    function getUserLpAmounts(address _user)
        public
        view
        returns (uint256 amount)
    {
        UserInfo memory user = poolInfo.userInfo[_user];
        if (user.isEntity) {
            return user.amount;
        }

        return 0;
    }

    // // Update reward variables of the given pool to be up-to-date.
    // function updatePool(uint256 _pid) public poolExists(_pid) {
    //     if (block.number <= poolInfo[_pid].lastRewardBlock) {
    //         return;
    //     }

    //     if (poolInfo[_pid].poolFactor == 0 || totalXFactor == 0) {
    //         return;
    //     }

    //     PoolInfo storage pool = poolInfo[_pid];
    //     (uint256 poolReward, , ) =
    //         getXCountToReward(pool.lastRewardBlock, block.number);
    //     poolReward = poolReward.mul(pool.poolFactor).div(totalXFactor);

    //     uint256 totalLpSupply = 0;
    //     for (uint256 i = 0; i < pool.LpTokenInfos.length; i++) {
    //         LpTokenInfo memory lpInfo = pool.LpTokenInfos[i];
    //         uint256 lpSupply = lpInfo.lpToken.balanceOf(address(this));
    //         if (lpSupply == 0) {
    //             continue;
    //         }
    //         totalLpSupply = totalLpSupply.add(lpSupply);
    //         uint256 lpReward =
    //             poolReward.mul(lpInfo.lpFactor).div(pool.poolFactor);
    //         pool.LpTokenInfos[i].lpAccPerShare = lpInfo.lpAccPerShare.add(
    //             lpReward.mul(1e12).div(lpSupply)
    //         );
    //     }

    //     if (totalLpSupply == 0) {
    //         pool.lastRewardBlock = block.number;
    //         return;
    //     }

    //     //xdex.mint(address(this), poolReward);
    //     pool.lastRewardBlock = block.number;
    // }

    function pendingReward(address _user) external view returns (uint256) {
        //PoolInfo memory pool = poolInfo[_pid];

        // uint256 totalPending = 0;
        // if (totalXFactor == 0 || pool.poolFactor == 0) {
        //     for (uint256 i = 0; i < pool.LpTokenInfos.length; i++) {
        //         UserInfo memory user =
        //             poolInfo[_pid].LpTokenInfos[i].userInfo[_user];
        //         totalPending = totalPending.add(
        //             user
        //                 .amount
        //                 .mul(pool.LpTokenInfos[i].lpAccPerShare)
        //                 .div(1e12)
        //                 .sub(user.rewardDebt)
        //         );
        //     }

        //     return totalPending;
        // }

        (uint256 xdexReward, , ) =
            getXCountToReward(pool.lastRewardBlock, block.number);

        uint256 poolReward = xdexReward.mul(pool.poolFactor).div(totalXFactor);

        for (uint256 i = 0; i < pool.LpTokenInfos.length; i++) {
            LpTokenInfo memory lpInfo = pool.LpTokenInfos[i];
            uint256 lpSupply = lpInfo.lpToken.balanceOf(address(this));
            if (lpSupply == 0) {
                continue;
            }
            if (block.number > pool.lastRewardBlock) {
                uint256 lpReward =
                    poolReward.mul(lpInfo.lpFactor).div(pool.poolFactor);
                lpInfo.lpAccPerShare = lpInfo.lpAccPerShare.add(
                    lpReward.mul(1e12).div(lpSupply)
                );
            }
            UserInfo memory user =
                poolInfo[_pid].LpTokenInfos[i].userInfo[_user];
            totalPending = totalPending.add(
                user.amount.mul(lpInfo.lpAccPerShare).div(1e12).sub(
                    user.rewardDebt
                )
            );
        }

        return totalPending;
    }

    function deposit(uint256 _amount) public {
        require(msg.sender == tx.origin, "do not deposit from contract");

        PoolInfo storage pool = poolInfo[_pid];
        uint256 index = _getLpIndexInPool(_pid, _lpToken);
        updatePool(_pid);

        UserInfo storage user =
            poolInfo[_pid].LpTokenInfos[index].userInfo[msg.sender];

        if (user.amount > 0) {
            uint256 pending =
                user
                    .amount
                    .mul(pool.LpTokenInfos[index].lpAccPerShare)
                    .div(1e12)
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
                        stream.fundsToStream(streamId, pending);
                    }
                } else {
                    if (hasNormalStream) {
                        //add funds
                        uint256 streamId =
                            stream.getStreamId(msg.sender, StreamTypeNormal);
                        require(streamId > 0, "not valid stream id");

                        xdex.approve(address(stream), pending);
                        stream.fundsToStream(streamId, pending);
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
                if (hasVotingStream == false) {
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
                if (hasNormalStream == false) {
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
    function withdraw(uint256 _amount) public nonReentrant {
        require(msg.sender == tx.origin, "do not withdraw from contract");

        PoolInfo storage pool = poolInfo[_pid];
        uint256 index = _getLpIndexInPool(_pid, _lpToken);
        updatePool(_pid);

        UserInfo storage user =
            poolInfo[_pid].LpTokenInfos[index].userInfo[msg.sender];
        require(user.amount >= _amount, "withdraw: _amount not good");

        uint256 pending =
            user
                .amount
                .mul(pool.LpTokenInfos[index].lpAccPerShare)
                .div(1e12)
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
                    stream.fundsToStream(streamId, pending);
                }
            } else {
                if (hasNormalStream) {
                    //add fund
                    uint256 streamId =
                        stream.getStreamId(msg.sender, StreamTypeNormal);
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
    function emergencyWithdraw() public nonReentrant {
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

    function getCountToReward(uint256 _from, uint256 _to)
        public
        view
        returns (
            uint256 _totalReward,
            uint256 _stageFrom,
            uint256 _stageTo
        )
    {
        require(_from <= _to, "_from must <= _to");

        /*
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

        */
    }

    function getCurRewardPerBlock() public view returns (uint256) {
        uint256 bnum = block.number;
        if (bnum < startBlock || bnum > stopBlock) {
            return 0;
        }

        return rewardAmount / (stopBlock - startBlock);
    }

    function setCore(address _core) public onlyCore {
        emit CoreTransferred(core, _core);
        core = _core;
    }
}
