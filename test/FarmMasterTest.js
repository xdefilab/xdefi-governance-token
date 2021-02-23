const { expectRevert, time } = require('@openzeppelin/test-helpers');
const truffleAssert = require("truffle-assertions");
const XDEX = artifacts.require('XDEX');
const XHalflife = artifacts.require('XHalfLife');
const XdexStream = artifacts.require('XdexStream');
const FarmMaster = artifacts.require('FarmMaster');
const MockERC20 = artifacts.require('MockToken');
const StreamTypeVoting = 0;
const StreamTypeNormal = 1;

contract('FarmMaster', ([alice, bob, carol, minter]) => {
    beforeEach(async () => {
        this.xdex = await XDEX.new({ from: alice });
        this.halflife = await XHalflife.new({ from: alice });
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
            this.master = await FarmMaster.new(this.xdex.address, '10', { from: alice });
            this.stream = await XdexStream.new(this.xdex.address, this.halflife.address, this.master.address);

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setStream(this.stream.address, { from: alice });
            await this.master.addPool(this.lp.address, 0, '100', false, { from: alice });
            await this.master.setVotingPool('10', { from: alice });
            await this.lp.approve(this.master.address, '1000', { from: bob });

            await this.master.deposit(0, this.lp.address, '100', { from: bob });
            assert.equal((await this.lp.balanceOf(bob)).toString(), '900');
            await this.master.emergencyWithdraw(0, { from: bob });
            assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');

            //amount left should be 0
            let lpAmounts = (await this.master.getUserLpAmounts(0, bob, { from: alice })).amounts;
            assert.equal(lpAmounts.length, '1');
            assert.equal(lpAmounts[0].toString(), '0');
        });

        it('should give out different XDEX on each stage', async () => {
            // start at block 50
            this.master = await FarmMaster.new(this.xdex.address, '50', { from: alice });
            this.stream = await XdexStream.new(this.xdex.address, this.halflife.address, this.master.address);

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setStream(this.stream.address, { from: alice });
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
            assert.equal(stream.kBlock.toString(), '60');
            assert.equal(stream.depositAmount.toString(), '10000000000000000000');
            assert.equal(stream.startBlock.toString(), '51');
            assert.equal(stream.remaining, '10000000000000000000');
            assert.equal(stream.withdrawable, '0');
            assert.equal(stream.lastRewardBlock.toString(), '51');

            await time.advanceBlockTo('54');
            await this.master.withdraw(0, this.lp.address, '0', { from: bob }); // block 55

            //fund to stream
            stream = await this.halflife.getStream('1');
            assert.equal(stream.depositAmount.toString(), '650000000000000000000');// 160*4 + 10
            assert.equal((await this.halflife.balanceOf('1')).remaining.toString(), '649700473881276128390');
            assert.equal((await this.halflife.balanceOf('1')).withdrawable.toString(), '299526118723871610');

            await time.advanceBlockTo('84');

            let result = await this.master.withdraw(0, this.lp.address, 100, { from: bob });// block 85
            //emits a Withdraw event
            truffleAssert.eventEmitted(result, "Withdraw");

            assert.equal((await this.xdex.totalSupply()).toString(), '5610000000000000000000');//160*35 + 10
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '1120000000000000000000');
            assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');

            let reward = (await this.master.getXCountToReward('50', '85'))._totalReward.toString();
            assert.equal(reward, '5600000000000000000000');
            assert.equal((await this.master.pendingXDEX('0', bob)).toString(), '0');

            let streamWithdraw = (await this.halflife.balanceOf('1')).withdrawable.toString();
            let streamRemain = (await this.halflife.balanceOf('1')).remaining.toString();

            assert.equal(streamWithdraw, '1584937608830024452');
            assert.equal(streamRemain, '4488415062391169975548');

            await time.advanceBlockTo('91');
            await this.master.withdraw(0, this.lp.address, '0', { from: bob });

            assert.equal((await this.halflife.balanceOf('1')).withdrawable.toString(), '2108817456020796274');
            assert.equal((await this.halflife.balanceOf('1')).remaining.toString(), '4487891182543979203726');
            assert.equal((await this.xdex.totalSupply()).toString(), '5610000000000000000000');// 160*35 + 10

            await time.advanceBlockTo('93');
            //withdraw all
            await this.halflife.withdrawFromStream('1', '2108817456020796274', { from: bob });
            assert.equal((await this.xdex.balanceOf(bob)).toString(), "1122108817456020796274");

            assert.equal((await this.halflife.balanceOf('1')).withdrawable.toString(), '149668725078948252');
            assert.equal((await this.halflife.balanceOf('1')).remaining.toString(), '4487741513818900255474');
        });


        it('test calc XDex Counts To Reward', async () => {
            //farming starts at block 100
            this.master = await FarmMaster.new(this.xdex.address, '100', { from: alice });

            let reward = (await this.master.getXCountToReward(10, 1000))._totalReward.toString();
            assert.equal(reward, '144000000000000000000000');

            reward = (await this.master.getXCountToReward(40000, 120300))._totalReward.toString();
            assert.equal(reward, '8032000000000000000000000');

            reward = (await this.master.getXCountToReward(600000, 601000))._totalReward.toString();
            assert.equal(reward, '20000000000000000000000');
        });

        it('should give out XDEX only after farming time', async () => {
            //farming start at block 130
            this.master = await FarmMaster.new(this.xdex.address, '130', { from: alice });
            this.stream = await XdexStream.new(this.xdex.address, this.halflife.address, this.master.address);

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setStream(this.stream.address);
            await this.master.addPool(this.lp.address, 0, '100', true);
            await this.master.setVotingPool('10', { from: alice });
            await this.lp.approve(this.master.address, '1000', { from: bob });

            await time.advanceBlockTo('129');
            await this.master.deposit(0, this.lp.address, '100', { from: bob });

            await time.advanceBlockTo('160');
            await this.master.withdraw(0, this.lp.address, '0', { from: bob }); // block 161

            let stream = await this.halflife.getStream('1');
            assert.equal(stream.depositAmount.toString(), '3978000000000000000000');// 160 * 31 * 0.8 + 10
            assert.equal(stream.withdrawable.toString(), '997497250625000000');
            assert.equal(stream.remaining.toString(), '3977002502749375000000');
            assert.equal(stream.lastRewardBlock.toString(), '161');
            // bob got 992 xdex
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '992000000000000000000');

            await time.advanceBlockTo('184');
            await this.master.withdraw(0, this.lp.address, '0', { from: bob }); // block 185
            stream = await this.halflife.getStream('1');
            assert.equal(stream.depositAmount.toString(), '7050000000000000000000');
            assert.equal(stream.withdrawable.toString(), '3510867266553240101');
            assert.equal(stream.remaining.toString(), '7046489132733446759899');
            assert.equal(stream.lastRewardBlock.toString(), '185');

            //bob withdraw 0.108
            await this.halflife.withdrawFromStream('1', '108000000000000000', { from: bob });
            //xdex total supply is 160 * 55 + 10 = 8810
            assert.equal((await this.xdex.totalSupply()).toString(), '8810000000000000000000');
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '1760108000000000000000');
            assert.equal((await this.halflife.balanceOf('1')).withdrawable.toString(), '3520366532336448371');
        });

        it('should not distribute XDEX if no one deposit', async () => {
            // farming starts at block 100
            this.master = await FarmMaster.new(this.xdex.address, '210', { from: alice });
            this.stream = await XdexStream.new(this.xdex.address, this.halflife.address, this.master.address);

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setStream(this.stream.address);
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
            assert.equal((await this.xdex.totalSupply()).toString(), "1610000000000000000000"); //160 * 10 + 10
            assert.equal((await this.lp.balanceOf(bob)).toString(), "1000");
        });


        it('should distribute XDEX properly for each staker', async () => {
            // farm start at block 300
            this.master = await FarmMaster.new(this.xdex.address, '300', { from: alice });
            this.stream = await XdexStream.new(this.xdex.address, this.halflife.address, this.master.address);

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setStream(this.stream.address);
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

            assert.equal((await this.xdex.totalSupply()).toString(), '1630000000000000000000'); //160 * 10 + 30

            //At this point:
            //Alice should have: 4*160 + 4*1/3*160 + 2*1/6*160 = 1360
            assert.equal((await this.halflife.balanceOf('1')).remaining.toString(), '735023375930995763889');
            //bob balance 10
            assert.equal((await this.halflife.balanceOf('2')).remaining.toString(), '9999166284478202160');
            //carol balance 10
            assert.equal((await this.halflife.balanceOf('3')).remaining.toString(), '9999833251334714500');
            //FarmMaster should have the remaining: 2400 - 1360 = 1040
            assert.equal((await this.xdex.balanceOf(this.master.address)).toString(), '693333333333333333334');

            let bobPending = (await this.master.pendingXDEX(0, bob)).toString();
            let carolPending = (await this.master.pendingXDEX(0, carol)).toString();

            // Bob pending XDEX: 4*2/3*160 + 2*1/3*160 = 1600/3
            assert.equal(bobPending, '533333333333333333333');
            // Carol pending XDEX: 2*3/6*160
            assert.equal(carolPending, '160000000000000000000');

            // Bob withdraws 5 LPs at block 330. At this point:
            //   Bob should have: 800 + 10*2/7*240 = 1485.71
            await time.advanceBlockTo('329');
            await this.master.withdraw(0, this.lp.address, '5', { from: bob });

            assert.equal((await this.xdex.totalSupply()).toString(), '3230000000000000000000'); //3230
            //bob balance
            assert.equal((await this.halflife.balanceOf('2')).remaining.toString(), '802081135252429315476');
            //carol balance
            assert.equal((await this.halflife.balanceOf('3')).remaining.toString(), '9998165917602229940');
            assert.equal((await this.xdex.balanceOf(this.master.address)).toString(), '1302857142857142857144');

            // Alice withdraws 20 LPs at block 340.
            // Bob withdraws 15 LPs at block 350.
            // Carol withdraws 30 LPs at block 360.
            await time.advanceBlockTo('339')
            await this.master.withdraw(0, this.lp.address, '20', { from: alice });
            await time.advanceBlockTo('349')
            await this.master.withdraw(0, this.lp.address, '15', { from: bob });
            await time.advanceBlockTo('359')
            await this.master.withdraw(0, this.lp.address, '30', { from: carol });
            assert.equal((await this.xdex.totalSupply()).toString(), '8030000000000000000000'); //8000 + 30
            // Alice should have
            assert.equal((await this.halflife.balanceOf('1')).remaining.toString(), '1493587203944409219363');
            assert.equal((await this.halflife.balanceOf('1')).withdrawable.toString(), '1306568949363674410');
            // Bob should have:  + 10*1.5/6.5 * 160 + 10*1.5/4.5*160 + 10
            assert.equal((await this.halflife.balanceOf('2')).remaining.toString(), '1523370107051500594763');
            assert.equal((await this.halflife.balanceOf('2')).withdrawable.toString(), '1062127380733837472');
            // Carol should have:  + 10*3/6.5*160 + 10*3/4.5*160 + 10*160 + 10 
            assert.equal((await this.halflife.balanceOf('3')).remaining.toString(), '3410128481894041661797');
            assert.equal((await this.halflife.balanceOf('3')).withdrawable.toString(), '545510779951012196');
            // All of them should have 1000 LPs back.
            assert.equal((await this.lp.balanceOf(alice)).toString(), '1000');
            assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');
            assert.equal((await this.lp.balanceOf(carol)).toString(), '1000');
        });


        it('should set pool factor to each lp token', async () => {
            // start at block 400
            this.master = await FarmMaster.new(this.xdex.address, '380', { from: alice });
            this.stream = await XdexStream.new(this.xdex.address, this.halflife.address, this.master.address);

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setStream(this.stream.address);
            await this.lp.approve(this.master.address, '1000', { from: alice });
            await this.lp2.approve(this.master.address, '1000', { from: bob });

            await this.master.addPool(this.lp.address, 0, '10', true);
            await this.master.addPool(this.lp2.address, 0, '20', true);

            await this.master.deposit(0, this.lp.address, '10', { from: alice });
            await this.master.deposit(1, this.lp2.address, '5', { from: bob });

            await time.advanceBlockTo('384');
            // change pool1 factor from 20 to 50
            await this.master.setLpFactor(1, this.lp2.address, '50', true);

            // Alice should have 5*1/3*160 = 266.66, Bob should have 5*2/3*160 = 533.33
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '266666666666666666666');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '533333333333333333333');

            await time.advanceBlockTo('390');
            // Alice should have 266.66 + 5*1/6*160, Bob should have 533.33 + 5*5/6*160
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '399999999999999999999');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '1199999999999999999999');
        });

        it('should give proper XDEX allocation by xFactor to each pool', async () => {
            // start at block 400
            this.master = await FarmMaster.new(this.xdex.address, '400', { from: alice });
            this.stream = await XdexStream.new(this.xdex.address, this.halflife.address, this.master.address);

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setStream(this.stream.address);
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
            // Alice should have 10*160 pending reward
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '1600000000000000000000');
            // Bob deposits 5 LP2s at block 425
            await time.advanceBlockTo('424');
            await this.master.deposit(1, this.lp2.address, '5', { from: bob });
            // Alice should have 1600 + 5*1/3*160 pending reward
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '1866666666666666666666');
            await time.advanceBlockTo('430');
            // At block 430. Bob should get 5*2/3*160. Alice should get 2133.33.
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '2133333333333333333333');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '533333333333333333333');
        });

        it('should accept multi lp tokens by each pool', async () => {
            // start at block 500
            this.master = await FarmMaster.new(this.xdex.address, '500', { from: alice });
            this.stream = await XdexStream.new(this.xdex.address, this.halflife.address, this.master.address);

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setStream(this.stream.address);
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

            // Alice should have 10*160 pending reward
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '1600000000000000000000');

            // Bob deposits 20 LP2s at block 525
            await time.advanceBlockTo('524');
            await this.master.deposit(0, this.lp2.address, '20', { from: bob });

            // Alice should have 1600 + 5*1/4*160 = 2700 pending reward
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '1800000000000000000000');

            await time.advanceBlockTo('530');
            // At block 430. Bob should get 5*3/4*160 = 600, alice should get 5*1/4*160=300
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '2000000000000000000000');
            assert.equal((await this.master.pendingXDEX(0, bob)).toString(), '600000000000000000000');
        });

        it('should stop giving bonus XDEX after the bonus period ends', async () => {
            //farm start at block 600
            this.master = await FarmMaster.new(this.xdex.address, '600', { from: alice });
            this.stream = await XdexStream.new(this.xdex.address, this.halflife.address, this.master.address);

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setStream(this.stream.address);
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

        it('should stop giving bonus XDEX when the pool factor is 0', async () => {
            this.lp3 = await MockERC20.new('LPToken2', 'LP2', '10000000000', { from: minter });
            await this.lp3.transfer(alice, '1000', { from: minter });
            await this.lp3.transfer(bob, '1000', { from: minter });
            await this.lp3.transfer(carol, '1000', { from: minter });

            // start at block 700
            this.master = await FarmMaster.new(this.xdex.address, '700', { from: alice });
            this.stream = await XdexStream.new(this.xdex.address, this.halflife.address, this.master.address);

            await this.xdex.setCore(this.master.address, { from: alice });
            await this.master.setStream(this.stream.address);
            await this.master.setVotingPool('10', { from: alice });

            await this.lp.approve(this.master.address, '1000', { from: alice });
            await this.lp2.approve(this.master.address, '1000', { from: alice });
            await this.lp2.approve(this.master.address, '1000', { from: bob });
            await this.lp3.approve(this.master.address, '1000', { from: bob });
            await this.lp.approve(this.master.address, '1000', { from: carol });
            await this.lp3.approve(this.master.address, '1000', { from: carol });

            await time.advanceBlockTo('660');
            //Pool 0 -> (LP1, 10) + (LP3, 30)
            await this.master.addPool(this.lp.address, 0, '10', false, { from: alice });
            await this.master.addLpTokenToPool(0, this.lp3.address, 0, '30', { from: alice });

            //Pool 1 -> (LP2, 20)
            await this.master.addPool(this.lp2.address, 0, '20', true, { from: alice });

            await time.advanceBlockTo('680');
            //Alice: (P0, LP1, 10), (P1, LP2, 25)
            //Bob: (P0, LP3, 20), (P1, LP2, 15)
            //Carol: (P0, LP1, 30), (P0, LP3, 80)
            await this.master.deposit(0, this.lp.address, '10', { from: alice });
            await this.master.deposit(1, this.lp2.address, '25', { from: alice });
            await this.master.deposit(0, this.lp3.address, '20', { from: bob });
            await this.master.deposit(1, this.lp2.address, '15', { from: bob });
            await this.master.deposit(0, this.lp.address, '30', { from: carol });
            await this.master.deposit(0, this.lp3.address, '80', { from: carol });

            //check balance
            await time.advanceBlockTo('690');
            assert.equal((await this.lp.balanceOf(this.master.address)).toString(), '40');
            assert.equal((await this.lp2.balanceOf(this.master.address)).toString(), '40');
            assert.equal((await this.lp3.balanceOf(this.master.address)).toString(), '100');

            await time.advanceBlockTo('705');
            // Alice should have P0: 50 XDEX, P1: 250 XDEX
            // Bob should have P0: 120 XDEX, P1: 150 XDEX
            // Carol should have P0: 630 XDEX, P1: 0 XDEX
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '33333333333333333333');
            assert.equal((await this.master.pendingXDEX(1, alice)).toString(), '166666666666666666666');
            assert.equal((await this.master.pendingXDEX(0, bob)).toString(), '79999999999999999999');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '99999999999999999999');
            assert.equal((await this.master.pendingXDEX(0, carol)).toString(), '419999999999999999998');
            assert.equal((await this.master.pendingXDEX(1, carol)).toString(), '0');

            await time.advanceBlockTo('709');
            // change pool1 lp2 factor from 20 to 40
            await this.master.setLpFactor(1, this.lp2.address, '40', true);//block 710

            await time.advanceBlockTo('715');
            // Alice should have P0: 50*2 + 37.5 XDEX, P1: 250*2 + 375 XDEX
            // Bob should have P0: 120*2 + 90 XDEX, P1: 150*2 + 225 XDEX
            // Carol should have P0: 630*2 + 360 + 112.5 XDEX, P1: 0 XDEX
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '91666666666666666666');
            assert.equal((await this.master.pendingXDEX(1, alice)).toString(), '583333333333333333333');
            assert.equal((await this.master.pendingXDEX(0, bob)).toString(), '219999999999999999999');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '349999999999999999999');
            assert.equal((await this.master.pendingXDEX(0, carol)).toString(), '1154999999999999999998');
            assert.equal((await this.master.pendingXDEX(1, carol)).toString(), '0');

            await time.advanceBlockTo('719');
            //change pool0 lp1 factor to 0, then lp1 is soft deleted
            //Pool 0 -> (LP1, 0) + (LP3, 30)
            await this.master.setLpFactor(0, this.lp.address, '0', true);

            await time.advanceBlockTo('725');
            //Important: Alice should be 175
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '116666666666666666666');
            assert.equal((await this.master.pendingXDEX(1, alice)).toString(), '1119047619047619047618');
            assert.equal((await this.master.pendingXDEX(0, bob)).toString(), '348571428571428571428');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '671428571428571428571');
            assert.equal((await this.master.pendingXDEX(0, carol)).toString(), '1744285714285714285711');
            assert.equal((await this.master.pendingXDEX(1, carol)).toString(), '0');

            await time.advanceBlockTo('729');
            //change pool1 lp2 factor to 0, then pool1 is soft deleted
            //Pool 1 -> (LP2, 0)
            await this.master.setLpFactor(1, this.lp2.address, '0', true);//block 730

            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '116666666666666666666');
            assert.equal((await this.master.pendingXDEX(1, alice)).toString(), '1404761904761904761904');
            assert.equal((await this.master.pendingXDEX(0, bob)).toString(), '417142857142857142856');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '842857142857142857142');
            assert.equal((await this.master.pendingXDEX(0, carol)).toString(), '2018571428571428571426');
            assert.equal((await this.master.pendingXDEX(1, carol)).toString(), '0');

            await time.advanceBlockTo('735');
            // From 730 to 735, Alice should have
            // From 730 to 735, Bob should have P0: 
            // From 730 to 735, Carol should have P0:
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '116666666666666666666');
            assert.equal((await this.master.pendingXDEX(1, alice)).toString(), '1404761904761904761904');
            assert.equal((await this.master.pendingXDEX(0, bob)).toString(), '577142857142857142856');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '842857142857142857142');
            assert.equal((await this.master.pendingXDEX(0, carol)).toString(), '2658571428571428571426');
            assert.equal((await this.master.pendingXDEX(1, carol)).toString(), '0');

            await time.advanceBlockTo('739');
            //change pool0 lp3 factor to 0, all pools are soft deleted
            //then totalXFactor is 0
            await this.master.setLpFactor(0, this.lp3.address, '0', true);

            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '116666666666666666666');
            assert.equal((await this.master.pendingXDEX(1, alice)).toString(), '1404761904761904761904');
            assert.equal((await this.master.pendingXDEX(0, bob)).toString(), '737142857142857142856');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '842857142857142857142');
            assert.equal((await this.master.pendingXDEX(0, carol)).toString(), '3298571428571428571426');
            assert.equal((await this.master.pendingXDEX(1, carol)).toString(), '0');

            await time.advanceBlockTo('760');
            // From 740 to 760, every one should have 0 XDEX 
            assert.equal((await this.master.pendingXDEX(0, alice)).toString(), '116666666666666666666');
            assert.equal((await this.master.pendingXDEX(1, alice)).toString(), '1404761904761904761904');
            assert.equal((await this.master.pendingXDEX(0, bob)).toString(), '737142857142857142856');
            assert.equal((await this.master.pendingXDEX(1, bob)).toString(), '842857142857142857142');
            assert.equal((await this.master.pendingXDEX(0, carol)).toString(), '3298571428571428571426');
            assert.equal((await this.master.pendingXDEX(1, carol)).toString(), '0');

            //check alice's stream
            let streamId = await this.stream.getStreamId(alice, StreamTypeNormal);
            let withdrawable = (await this.halflife.balanceOf(streamId)).withdrawable.toString();
            let remaining = (await this.halflife.balanceOf(streamId)).remaining.toString();
            //console.log('streamId:', streamId, ',withdrawable:', withdrawable, ',remaining:', remaining);
            assert.equal(withdrawable, '10000000000000000');//0.01
            assert.equal(remaining, '9990000000000000000');//9.99
        });
    });
});