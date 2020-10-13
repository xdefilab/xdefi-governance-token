const { expectRevert, time } = require('@openzeppelin/test-helpers');
const truffleAssert = require("truffle-assertions");
const XDEX = artifacts.require('XDEX');
const XHalflife = artifacts.require('XHalfLife');
const XStream = artifacts.require('XStream');
const ONE = 10 ** 18;
const StreamTypeVoting = 0;
const StreamTypeNormal = 1;

/**
 * Roles:
 *  minter -> xdex / stream
 *  alice -> halflife core
 *        -> funded to all streams
 *  bob -> voting & normal stream
 *  carol -> voting & nromal stream
 */

contract('XStream', ([alice, bob, carol, minter]) => {
    beforeEach(async () => {
        this.xdex = await XDEX.new({ from: minter });
        this.halflife = await XHalflife.new(this.xdex.address, { from: minter });
        this.stream = await XStream.new(this.xdex.address, this.halflife.address, { from: minter });
        await this.xdex.setCore(alice, { from: minter });
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

            //emits a Create event
            truffleAssert.eventEmitted(result, "Create");

            await time.advanceBlockTo('20');
            let stream = await this.halflife.getStream(Number(result.logs[0].args.streamId));
            assert.equal(stream.sender, this.stream.address);
            assert.equal(stream.recipient, bob);
            assert.equal(stream.depositAmount.toString(), deposit);
            assert.equal(stream.startBlock, '40');
            assert.equal(stream.kBlock.toString(), '1800');
            assert.equal(stream.remaining.toString(), deposit);
            assert.equal(stream.withdrawable, '0');
            assert.equal(stream.lastRewardBlock, '40');

            //token transfered to the halflife contract
            let balance = (await this.xdex.balanceOf(this.halflife.address)).toString();
            assert.equal(balance, deposit);
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '70000000000000000000000');

            await time.advanceBlockTo('30');
            //should create normal stream
            result = await this.stream.createStream(bob, deposit, StreamTypeNormal, '40', { from: alice });

            //emits a Create event
            truffleAssert.eventEmitted(result, "Create");

            stream = await this.halflife.getStream(Number(result.logs[0].args.streamId));
            assert.equal(stream.sender, this.stream.address);
            assert.equal(stream.recipient, bob);
            assert.equal(stream.depositAmount, deposit);
            assert.equal(stream.startBlock, '40');
            assert.equal(stream.kBlock, '40');
            assert.equal(stream.remaining, deposit);
            assert.equal(stream.withdrawable, '0');
            assert.equal(stream.lastRewardBlock, '40');

            //token transfered to the halflife contract
            balance = (await this.xdex.balanceOf(this.halflife.address)).toString();
            assert.equal(balance, '60000000000000000000000');
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '40000000000000000000000');

            //could withdraw from normalStream
            await time.advanceBlockTo('85');
            let withdrawable = (await this.halflife.balanceOf('2')).withdrawable.toString();
            assert.equal(withdrawable, '30000000000000000000');
        });

        it('should withdraw from the stream', async () => {
            //3000 * ONE;
            let deposit = '30000000000000000000000';

            //should create normal stream
            let result = await this.stream.createStream(bob, deposit, StreamTypeNormal, '110', { from: alice });

            await time.advanceBlockTo('130');
            //bob's balance is zero
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '0');
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '70000000000000000000000');

            await expectRevert(
                this.stream.withdraw(StreamTypeNormal, '10', { from: carol }),
                'senders normalStream not exist',
            );

            await time.advanceBlockTo('150');
            await expectRevert(
                this.stream.withdraw(StreamTypeNormal, '90000000000000000000', { from: bob }),
                'amount exceeds the available balance',
            );

            await time.advanceBlockTo('155');
            //bob withdraw 1.5 from stream
            result = await this.stream.withdraw(StreamTypeNormal, '15000000000000000000', { from: bob });// block 156

            //emits a Withdraw event
            truffleAssert.eventEmitted(result, "Withdraw");

            //bob's balance is 1.5*ONE
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '15000000000000000000');
        });

        it('should send funds to the stream', async () => {
            //deposit 3000
            let deposit = '3000000000000000000000';

            //should create normal stream
            let result = await this.stream.createStream(bob, deposit, StreamTypeNormal, '200', { from: alice });
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '97000000000000000000000');
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '0');

            await time.advanceBlockTo('240');
            //bob withdraw 1.5 from stream
            await this.stream.withdraw(StreamTypeNormal, '1500000000000000000', { from: bob });// block 156
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '1500000000000000000');

            await time.advanceBlockTo('249');
            //alice fund '1000' to the stream
            result = await this.stream.fundsToStream(Number(result.logs[0].args.streamId), '1000000000000000000000', { from: alice });

            //alice balance = 100 - 3 - 1 = 96
            assert.equal((await this.xdex.balanceOf(alice)).toString(), '96000000000000000000000');

            //emits a Fund event
            truffleAssert.eventEmitted(result, "Fund");

            await time.advanceBlockTo('255');
            let remaining = (await this.halflife.balanceOf('1')).remaining.toString();
            let withdrawable = (await this.halflife.balanceOf('1')).withdrawable.toString();
            //remaining = 3000 - 3 + 1000 = 3997, withdrawable = 3 - 1.5 = 1.5
            assert.equal(remaining, '3997000000000000000000');
            assert.equal(withdrawable, '1500000000000000000');

            //bob withdraw 0.2 from stream
            await this.stream.withdraw(StreamTypeNormal, '200000000000000000', { from: bob });
            assert.equal((await this.xdex.balanceOf(bob)).toString(), '1700000000000000000');

            await time.advanceBlockTo('290');
            //remaining = 3997 - 3.997 = 3993.003
            remaining = (await this.halflife.balanceOf('1')).remaining.toString();
            //withdrawable = 1.5 + 3.997 = 5.497
            withdrawable = (await this.halflife.balanceOf('1')).withdrawable.toString();
            assert.equal(remaining, '3993003000000000000000');
            assert.equal(withdrawable, '5297000000000000000');
        });
    });
});