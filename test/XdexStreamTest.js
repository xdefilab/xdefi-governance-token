const { expectRevert, time } = require('@openzeppelin/test-helpers');
const truffleAssert = require("truffle-assertions");
const XDEX = artifacts.require('XDEX');
const XHalflife = artifacts.require('XHalfLife');
const XStream = artifacts.require('XdexStream');
const FarmMaster = artifacts.require('FarmMaster');
const ONE = 10 ** 18;
const StreamTypeVoting = 0;
const StreamTypeNormal = 1;

contract('XStream', ([alice, bob, minter]) => {
    beforeEach(async () => {
        this.xdex = await XDEX.new({ from: alice });
        this.halflife = await XHalflife.new(this.xdex.address, { from: minter });
        this.stream = await XStream.new(this.xdex.address, this.halflife.address, alice, { from: minter });
    });

    it('should set correct state variables', async () => {
        const xdexCore = await this.xdex.core();
        assert.equal(xdexCore, alice);
    });

    context('should create streams successfully', async () => {
        beforeEach(async () => {
            await this.xdex.mint(alice, '100000000000000000000000', { from: alice });
            await this.xdex.approve(this.stream.address, '100000000000000000000000', { from: alice });
        });

        it('should create voting & normal streams successfully', async () => {
            let deposit = '30000000000000000000000';

            //should create voting stream
            let result = await this.stream.createStream(bob, deposit, StreamTypeVoting, '40', { from: alice });

            let streamId = await this.stream.getStreamId(bob, StreamTypeVoting);

            let stream = await this.halflife.getStream(streamId);
            assert.equal(stream.sender, this.stream.address);
            assert.equal(stream.recipient, bob);
            assert.equal(stream.depositAmount.toString(), deposit);
            assert.equal(stream.startBlock, '40');
            assert.equal(stream.kBlock.toString(), '540');
            assert.equal(stream.remaining.toString(), deposit);
            assert.equal(stream.withdrawable, '0');
            assert.equal(stream.lastRewardBlock, '40');
            assert.equal(stream.unlockRatio, '1');

            //token transfered to the halflife contract
            let balance = (await this.xdex.balanceOf(this.halflife.address)).toString();
            assert.equal(balance, deposit);
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '70000000000000000000000');

            await time.advanceBlockTo('30');
            //should create normal stream
            result = await this.stream.createStream(bob, deposit, StreamTypeNormal, '40', { from: alice });
            streamId = await this.stream.getStreamId(bob, StreamTypeNormal);

            stream = await this.halflife.getStream(streamId);
            assert.equal(stream.sender, this.stream.address);
            assert.equal(stream.recipient, bob);
            assert.equal(stream.depositAmount, deposit);
            assert.equal(stream.startBlock, '40');
            assert.equal(stream.kBlock, '60');
            assert.equal(stream.remaining, deposit);
            assert.equal(stream.withdrawable, '0');
            assert.equal(stream.lastRewardBlock, '40');
            assert.equal(stream.unlockRatio, '1');

            //token transfered to the halflife contract
            balance = (await this.xdex.balanceOf(this.halflife.address)).toString();
            assert.equal(balance, '60000000000000000000000');
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '40000000000000000000000');

            //could withdraw from normalStream
            await time.advanceBlockTo('85');
            let withdrawable = (await this.halflife.balanceOf(streamId)).withdrawable.toString();
            assert.equal(withdrawable, '22502813671875000000');

            await time.advanceBlockTo('110');
            withdrawable = (await this.halflife.balanceOf(streamId)).withdrawable.toString();
            assert.equal(withdrawable, '34997082521875050000');//35.0

            await time.advanceBlockTo('120');
            //bob withdraw 15 from stream
            await this.halflife.withdrawFromStream(streamId, '15000000000000000000', { from: bob });// block 121
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '15000000000000000000');

            withdrawable = (await this.halflife.balanceOf(streamId)).withdrawable.toString();
            assert.equal(withdrawable, '25492910962498110000');//40.0 - 15.0 = 25.0

            await time.advanceBlockTo('160');
            withdrawable = (await this.halflife.balanceOf(streamId)).withdrawable.toString();
            assert.equal(withdrawable, '44969999997856133365');//25.0 + 20.0  
        });

        it('should send funds to the stream', async () => {
            //deposit 3000
            let deposit = '3000000000000000000000';

            //should create normal stream
            let result = await this.stream.createStream(bob, deposit, StreamTypeNormal, '200', { from: alice });
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '97000000000000000000000');
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '0');

            let streamId = await this.stream.getStreamId(bob, StreamTypeNormal);

            //could withdraw from normalStream
            await time.advanceBlockTo('240');
            withdrawable = (await this.halflife.balanceOf(streamId)).withdrawable.toString();
            assert.equal(withdrawable, '2000333481481482000');//2.0  

            await time.advanceBlockTo('249');
            //alice fund '1000' to the stream
            result = await this.stream.fundsToStream(streamId, '1000000000000000000000', { from: alice });
            withdrawable = (await this.halflife.balanceOf(streamId)).withdrawable.toString();
            let remaining = (await this.halflife.balanceOf(streamId)).remaining.toString();
            //console.log("streamId:" + streamId.toString() + ", remaining:" + remaining.toString() + ", withdrawable:" + withdrawable.toString());
            assert.equal(withdrawable, '2583574155093053000');//2.50 + 0.08 = 2.58
            assert.equal(remaining, '3997416425844906947000');//2997.5 + 1000.0 - 0.08 = 3997.42

            let stream = await this.halflife.getStream(streamId);
            assert.equal(stream.depositAmount, '4000000000000000000000');
            assert.equal(stream.lastRewardBlock, '250');

            //alice balance = 100 - 3 - 1 = 96
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '96000000000000000000000');

            await time.advanceBlockTo('255');
            remaining = (await this.halflife.balanceOf(streamId)).remaining.toString();
            withdrawable = (await this.halflife.balanceOf(streamId)).withdrawable.toString();
            assert.equal(remaining, '3997083155032775292681');//3997.08
            assert.equal(withdrawable, '2916844967224707319');//2.92

            //bob withdraw 0.2 from stream
            await time.advanceBlockTo('269');
            await this.halflife.withdrawFromStream(streamId, '200000000000000000', { from: bob });// block 270
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '200000000000000000');

            stream = await this.halflife.getStream(streamId);
            assert.equal(stream.depositAmount, '4000000000000000000000');
            assert.equal(stream.lastRewardBlock, '270');
            assert.equal(stream.remaining.toString(), '3996083509298823896912');//3996.08
            assert.equal(stream.withdrawable.toString(), '3716490701176103088');//3.71
        });
    });
});