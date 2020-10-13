const { expectRevert, time } = require('@openzeppelin/test-helpers');
const truffleAssert = require("truffle-assertions");
const XDEX = artifacts.require('XDEX');
const XHalflife = artifacts.require('XHalfLife');
const XStream = artifacts.require('XStream');
const FarmMaster = artifacts.require('FarmMaster');
const MockERC20 = artifacts.require('MockToken');
const StreamTypeVoting = 0;
const StreamTypeNormal = 1;

/**
 * Roles:
 * alice -> xdex minter
 * alice -> halflife
 * alice -> stream
 * alice -> farm master
 * minter -> lp
 * minter -> lp2
 * alice & bob & carol -> farming
 */
contract('FarmMaster', ([alice, bob, carol, minter]) => {
    beforeEach(async () => {
        this.xdex = await XDEX.new({ from: alice });
        this.halflife = await XHalflife.new(this.xdex.address, { from: alice });
        this.stream = await XStream.new(this.xdex.address, this.halflife.address, { from: alice });
    });

    it('should set correct state variables', async () => {
        this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '0', alice, { from: minter });

        const masterCore = await this.master.core();
        const xdexCore = await this.xdex.core();

        assert.equal(masterCore, alice);
        assert.equal(xdexCore, alice);
    });

    context('With ERC-LP token added to the field', () => {
        beforeEach(async () => {
            this.lp = await MockERC20.new('LPToken', 'LP', '10000000000', { from: minter });
            await this.lp.transfer(alice, '1000', { from: minter });
            await this.lp.transfer(bob, '1000', { from: minter });
            await this.lp.transfer(carol, '1000', { from: minter });
            this.lp2 = await MockERC20.new('LPToken2', 'LP2', '10000000000', { from: minter });
            await this.lp2.transfer(alice, '1000', { from: minter });
            await this.lp2.transfer(bob, '1000', { from: minter });
            await this.lp2.transfer(carol, '1000', { from: minter });
        });

        it('should allow emergency withdraw', async () => {
            // start at block 10
            this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '10', alice, { from: minter });

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.addPool(this.lp.address, 0, '100', true, { from: alice });
            await this.master.setVotingPool('10', { from: alice });
            await this.lp.approve(this.master.address, '1000', { from: bob });

            await this.master.deposit(0, this.lp.address, '100', { from: bob });
            assert.equal((await this.lp.balanceOf(bob)).toString(), '900');
            await this.master.emergencyWithdraw(0, { from: bob });
            assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');
        });

        it('should give out different XDEX on each stage', async () => {
            // start at block 50
            this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '50', alice, { from: minter });

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.addPool(this.lp.address, 0, '100', true, { from: alice });//normal pool
            await this.master.setVotingPool('10', { from: alice });
            await this.lp.approve(this.master.address, '1000', { from: bob });

            await time.advanceBlockTo('49');
            await this.master.deposit(0, this.lp.address, '100', { from: bob }); // block 50
            assert.equal((await this.lp.balanceOf(bob)).toString(), '900');

            //created new normal stream by `bonusFirstDeposit`
            stream = await this.halflife.getStream('1');
            assert.equal(stream.sender, this.stream.address);
            assert.equal(stream.recipient, bob);
            assert.equal(stream.kBlock.toString(), '40');
            assert.equal(stream.depositAmount.toString(), '10000000000000000000');
            assert.equal(stream.startBlock.toString(), '51');
            assert.equal(stream.remaining, '10000000000000000000');
            assert.equal(stream.withdrawable, '0');
            assert.equal(stream.lastRewardBlock.toString(), '51');

            await time.advanceBlockTo('54');
            await this.master.deposit(0, this.lp.address, '0', { from: bob }); // block 55

            //fund to stream
            stream = await this.halflife.getStream('1');
            assert.equal(stream.depositAmount.toString(), '1210000000000000000000');//240*5 + 10
            assert.equal((await this.halflife.balanceOf('1')).remaining.toString(), '1210000000000000000000');
            assert.equal((await this.halflife.balanceOf('1')).withdrawable.toString(), '0');

            await time.advanceBlockTo('84');

            let result = await this.master.withdraw(0, this.lp.address, 100, { from: bob });// block 85
            //emits a Withdraw event
            truffleAssert.eventEmitted(result, "Withdraw");

            assert.equal((await this.xdex.totalSupply()).toString(), '8410000000000000000000');//240*35 + 10
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '0');
            assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');

            let reward = (await this.master.getXCountToReward('50', '85'))._totalReward.toString();
            assert.equal(reward, '8400000000000000000000');//240*35=8400
            assert.equal((await this.master.pendingXDEX('0', bob)).toString(), '0');

            let streamWithdraw = (await this.halflife.balanceOf('1')).withdrawable.toString();
            let streamRemain = (await this.halflife.balanceOf('1')).remaining.toString();
            //None withdrawable 
            assert.equal(streamWithdraw, '0');
            assert.equal(streamRemain, '8410000000000000000000');

            await time.advanceBlockTo('91');
            await this.master.deposit(0, this.lp.address, '0', { from: bob });
            //12.61 is withdrawable 
            assert.equal((await this.halflife.balanceOf('1')).withdrawable.toString(), '8410000000000000000');
            assert.equal((await this.halflife.balanceOf('1')).remaining.toString(), '8401590000000000000000');
            assert.equal((await this.xdex.totalSupply()).toString(), '8410000000000000000000');// 240*35 + 10

            await time.advanceBlockTo('93');
            //withdraw all
            await this.stream.withdraw(StreamTypeNormal, '8410000000000000000', { from: bob });
            assert.equal((await this.xdex.balanceOf(bob)).toString(), "8410000000000000000");

            assert.equal((await this.halflife.balanceOf('1')).withdrawable.toString(), '0');
            assert.equal((await this.halflife.balanceOf('1')).remaining.toString(), '8401590000000000000000');
        });


        it('test calc XDex Counts To Reward', async () => {
            //farming starts at block 100
            this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '100', alice, { from: alice });

            let reward = (await this.master.getXCountToReward(10, 1000))._totalReward.toString();
            assert.equal(reward, '216000000000000000000000');

            reward = (await this.master.getXCountToReward(40000, 120300))._totalReward.toString();
            assert.equal(reward, '9636000000000000000000000');

            reward = (await this.master.getXCountToReward(600000, 601000))._totalReward.toString();
            assert.equal(reward, '10200000000000000000000');
        });

        it('should give out XDEX only after farming time', async () => {
            //farming start at block 130
            this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '130', alice, { from: alice });

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.addPool(this.lp.address, 0, '100', true);
            await this.master.setVotingPool('10', { from: alice });
            await this.lp.approve(this.master.address, '1000', { from: bob });

            await time.advanceBlockTo('129');
            await this.master.deposit(0, this.lp.address, '100', { from: bob });

            await time.advanceBlockTo('160');
            await this.master.deposit(0, this.lp.address, '0', { from: bob }); // block 161

            let stream = await this.halflife.getStream('1');
            assert.equal(stream.depositAmount.toString(), '7450000000000000000000');// 240 * 31 + 10
            assert.equal(stream.withdrawable.toString(), '0');
            assert.equal(stream.remaining.toString(), '7450000000000000000000');
            assert.equal(stream.lastRewardBlock.toString(), '131');
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '0');

            await time.advanceBlockTo('184');
            await this.master.deposit(0, this.lp.address, '0', { from: bob }); // block 185
            stream = await this.halflife.getStream('1');
            assert.equal(stream.depositAmount.toString(), '13210000000000000000000');//240 * 55 + 10
            assert.equal(stream.withdrawable.toString(), '7450000000000000000');//7.45
            assert.equal(stream.remaining.toString(), '13202550000000000000000');//13202.55
            assert.equal(stream.lastRewardBlock.toString(), '171');

            //bob withdraw 0.108
            await this.stream.withdraw(StreamTypeNormal, '108000000000000000', { from: bob });
            //xdex total supply is 240 * 55 + 10 = 13210
            assert.equal((await this.xdex.totalSupply()).toString(), '13210000000000000000000');
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '108000000000000000');
            //7.45 - 0.108
            assert.equal((await this.halflife.balanceOf('1')).withdrawable.toString(), '7342000000000000000');
        });

        it('should not distribute XDEX if no one deposit', async () => {
            // farming starts at block 100
            this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '210', alice, { from: alice });

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.addPool(this.lp.address, 0, '100', true);
            await this.master.setVotingPool('10', { from: alice });
            await this.lp.approve(this.master.address, '1000', { from: bob });

            await time.advanceBlockTo('209');
            assert.equal((await this.xdex.totalSupply()).toString(), '0');
            await time.advanceBlockTo('214');
            assert.equal((await this.xdex.totalSupply()).toString(), '0');
            await time.advanceBlockTo('219');
            await this.master.deposit(0, this.lp.address, '10', { from: bob }); // block 220

            assert.equal((await this.xdex.totalSupply()).toString(), '10000000000000000000');//deposit bonus
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '0');
            assert.equal((await this.lp.balanceOf(bob)).toString(), '990');

            await time.advanceBlockTo('229');
            await this.master.withdraw(0, this.lp.address, '10', { from: bob });
            assert.equal((await this.xdex.totalSupply()).toString(), "2410000000000000000000"); //240 * 10 + 10
            assert.equal((await this.lp.balanceOf(bob)).toString(), "1000");
        });


        it('should distribute XDEX properly for each staker', async () => {
            // farm start at block 300
            this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '300', alice, { from: alice });
            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setVotingPool('10', { from: alice });
            await this.master.addPool(this.lp.address, 0, '100', true);
            await this.lp.approve(this.master.address, '1000', { from: alice });
            await this.lp.approve(this.master.address, '1000', { from: bob });
            await this.lp.approve(this.master.address, '1000', { from: carol });

            let bobBalance = (await this.xdex.balanceOf(bob)).toString();
            assert.equal(bobBalance, '0');

            // Alice deposits 10 LPs at block 310
            await time.advanceBlockTo('309');
            await this.master.deposit(0, this.lp.address, '10', { from: alice }); // block 310
            // Bob deposits 20 LPs at block 314
            await time.advanceBlockTo('313');
            await this.master.deposit(0, this.lp.address, '20', { from: bob }); // block 314
            // Carol deposits 30 LPs at block 318
            await time.advanceBlockTo('317');
            await this.master.deposit(0, this.lp.address, '30', { from: carol }); // block 318

            // Alice deposits 10 more LPs at block 320. 
            await time.advanceBlockTo('319');
            await this.master.deposit(0, this.lp.address, '10', { from: alice });// block 320

            assert.equal((await this.xdex.totalSupply()).toString(), '2430000000000000000000'); //2400 + 30

            //At this point:
            //Alice should have: 4*240 + 4*1/3*240 + 2*1/6*240 = 1360
            assert.equal((await this.halflife.balanceOf('1')).remaining.toString(), '1370000000000000000000');
            //bob balance 10
            assert.equal((await this.halflife.balanceOf('2')).remaining.toString(), '10000000000000000000');
            //carol balance 10
            assert.equal((await this.halflife.balanceOf('3')).remaining.toString(), '10000000000000000000');
            //FarmMaster should have the remaining: 2400 - 1360 = 1040
            assert.equal((await this.xdex.balanceOf(this.master.address)).toString(), '1040000000000000000000');

            let bobPending = (await this.master.pendingXDEX(0, bob)).toString();
            let carolPending = (await this.master.pendingXDEX(0, carol)).toString();

            // Bob pending XDEX: 4*2/3*240 + 2*1/3*240 = 800
            assert.equal(bobPending, '800000000000000000000');
            // Carol pending XDEX: 2*3/6*240 = 240
            assert.equal(carolPending, '240000000000000000000');

            // Bob withdraws 5 LPs at block 330. At this point:
            //   Bob should have: 800 + 10*2/7*240 = 1485.71
            await time.advanceBlockTo('329');
            await this.master.withdraw(0, this.lp.address, '5', { from: bob });

            assert.equal((await this.xdex.totalSupply()).toString(), '4830000000000000000000'); //4830
            //bob balance 10 + 1485.71
            assert.equal((await this.halflife.balanceOf('2')).remaining.toString(), '1495714285714285714285');
            //carol balance 10
            assert.equal((await this.halflife.balanceOf('3')).remaining.toString(), '10000000000000000000');
            assert.equal((await this.xdex.balanceOf(this.master.address)).toString(), '1954285714285714285715');

            // Alice withdraws 20 LPs at block 340.
            // Bob withdraws 15 LPs at block 350.
            // Carol withdraws 30 LPs at block 360.
            await time.advanceBlockTo('339')
            await this.master.withdraw(0, this.lp.address, '20', { from: alice });
            await time.advanceBlockTo('349')
            await this.master.withdraw(0, this.lp.address, '15', { from: bob });
            await time.advanceBlockTo('359')
            await this.master.withdraw(0, this.lp.address, '30', { from: carol });
            assert.equal((await this.xdex.totalSupply()).toString(), '12030000000000000000000'); //12000 + 30
            // Alice should have:  + 10*2/6.5*240 + 10 = 2794.17
            assert.equal((await this.halflife.balanceOf('1')).remaining.toString(), '2791381648351648351649');
            assert.equal((await this.halflife.balanceOf('1')).withdrawable.toString(), '2794175824175824175');
            // Bob should have:  + 10*1.5/6.5 * 240 + 10*1.5/4.5*240 + 10 = 2849.56
            assert.equal((await this.halflife.balanceOf('2')).remaining.toString(), '2846710879120879120879');
            assert.equal((await this.halflife.balanceOf('2')).withdrawable.toString(), '2849560439560439560');
            // Carol should have:  + 10*3/6.5*240 + 10*3/4.5*240 + 10*240 + 10 = 6387.25
            assert.equal((await this.halflife.balanceOf('3')).remaining.toString(), '6386253736263736263736');
            assert.equal((await this.halflife.balanceOf('3')).withdrawable.toString(), '10000000000000000');
            // All of them should have 1000 LPs back.
            assert.equal((await this.lp.balanceOf(alice)).toString(), '1000');
            assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');
            assert.equal((await this.lp.balanceOf(carol)).toString(), '1000');
        });


        it('should set pool factor to each lp token', async () => {
            // start at block 400
            this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '380', alice, { from: alice });
            await this.xdex.setCore(this.master.address, { from: alice });
            await this.lp.approve(this.master.address, '1000', { from: alice });
            await this.lp2.approve(this.master.address, '1000', { from: bob });

            await this.master.addPool(this.lp.address, 0, '10', true);
            await this.master.addPool(this.lp2.address, 0, '20', true);

            await this.master.deposit(0, this.lp.address, '10', { from: alice });
            await this.master.deposit(1, this.lp2.address, '5', { from: bob });

            await time.advanceBlockTo('384');
            // change pool1 factor from 20 to 50
            await this.master.setLpFactor(1, this.lp2.address, '50', true);

            // Alice should have 5*1/3*240 = 400, Bob should have 5*2/3*240 = 800
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '400000000000000000000');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '800000000000000000000');

            await time.advanceBlockTo('390');
            // Alice should have 400 + 5*1/6*240 = 600, Bob should have 800 + 5*5/6*240 = 1800
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '600000000000000000000');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '1800000000000000000000');
        });

        it('should give proper XDEX allocation by xFactor to each pool', async () => {
            // start at block 400
            this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '400', alice, { from: alice });
            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setVotingPool('10', { from: alice });
            await this.lp.approve(this.master.address, '1000', { from: alice });
            await this.lp2.approve(this.master.address, '1000', { from: bob });

            // Add first LP to the pool0 with factor 10
            await this.master.addPool(this.lp.address, 0, '10', true);
            // Alice deposits 10 LPs at block 410
            await time.advanceBlockTo('409');
            await this.master.deposit(0, this.lp.address, '10', { from: alice });

            await time.advanceBlockTo('419');
            // Add LP2 to the pool1 with factor 20 at block 420
            await this.master.addPool(this.lp2.address, 0, '20', true);
            // Alice should have 10*240 pending reward
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '2400000000000000000000');
            // Bob deposits 5 LP2s at block 425
            await time.advanceBlockTo('424');
            await this.master.deposit(1, this.lp2.address, '5', { from: bob });
            // Alice should have 2400 + 5*1/3*240 = 2800 pending reward
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '2800000000000000000000');
            await time.advanceBlockTo('430');
            // At block 430. Bob should get 5*2/3*240 = 800. Alice should get 600.
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '3200000000000000000000');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '800000000000000000000');
        });

        it('should accept multi lp tokens by each pool', async () => {
            // start at block 500
            this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '500', alice, { from: alice });
            await this.xdex.setCore(this.master.address, { from: alice });
            await this.lp.approve(this.master.address, '1000', { from: alice });
            await this.lp2.approve(this.master.address, '1000', { from: bob });

            // Add first LP to the pool0 with factor 100
            await this.master.addPool(this.lp.address, 0, '100', true);

            // Alice deposits 10 LPs at block 510
            await time.advanceBlockTo('509');
            await this.master.deposit(0, this.lp.address, '10', { from: alice });

            await time.advanceBlockTo('519');
            // Add LP2 to the pool0 with factor 300 at block 520
            await this.master.addLpTokenToPool(0, this.lp2.address, 0, '300', { from: alice });

            // Alice should have 10*240 pending reward
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '2400000000000000000000');

            // Bob deposits 20 LP2s at block 525
            await time.advanceBlockTo('524');
            await this.master.deposit(0, this.lp2.address, '20', { from: bob });

            // Alice should have 2400 + 5*1/4*240 = 2700 pending reward
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '2700000000000000000000');

            await time.advanceBlockTo('530');
            // At block 430. Bob should get 5*3/4*240 = 900, alice should get 5*1/4*240=300
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '3000000000000000000000');
            assert.equal((await this.master.pendingXDEX(0, bob)).toString(), '900000000000000000000');
        });

        it('should stop giving bonus XDEX after the bonus period ends', async () => {
            // farm start at block 1000
            this.master = await FarmMaster.new(this.xdex.address, this.stream.address, '1000', alice, { from: alice });
            await this.xdex.setCore(this.master.address, { from: alice });

            await this.lp.approve(this.master.address, '10000', { from: alice });
            await this.master.addPool(this.lp.address, 0, '1', true);

            //Warn: Advancing too many blocks is causing this test to be slow
            /*
            // Alice deposits 10 LPs at block 40490
            await time.advanceBlockTo('40489');
            await this.master.deposit(0, '10', { from: alice }); // block 40490

            // At block 40505, she should have 360*10 + 180*5 = 4500 pending.
            await time.advanceBlockTo('40505');
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '4500');

            // At block 40506, Alice withdraws all pending rewards and should get 4680.
            await this.master.deposit(0, '0', { from: alice });
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '0');
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '4680');
            */
        });
    });
});