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
            assert.equal(withdrawable, '1002091983948579836671');
            assert.equal(remaining, '2997908016051420163329');

            let stream = await this.halflife.getStream(streamId);
            assert.equal(stream.depositAmount, '4000000000000000000000');
            assert.equal(stream.lastRewardBlock, '250');

            //alice balance
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '96000000000000000000000');

            await time.advanceBlockTo('255');
            remaining = (await this.halflife.balanceOf(streamId)).remaining.toString();
            withdrawable = (await this.halflife.balanceOf(streamId)).withdrawable.toString();
            assert.equal(remaining, '2997658075806829739623');
            assert.equal(withdrawable, '1002341924193170260377');

            //bob withdraw 0.2 from stream
            await time.advanceBlockTo('269');
            await this.halflife.withdrawFromStream(streamId, '200000000000000000', { from: bob });// block 270
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '200000000000000000');

            stream = await this.halflife.getStream(streamId);
            assert.equal(stream.depositAmount, '4000000000000000000000');
            assert.equal(stream.lastRewardBlock, '270');
            assert.equal(stream.remaining.toString(), '2996908380093456302038');
            assert.equal(stream.withdrawable.toString(), '1002891619906543697962');
        });
    });
});