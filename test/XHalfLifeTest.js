const { expectRevert, time } = require("@openzeppelin/test-helpers");
const truffleAssert = require("truffle-assertions");
const XDEX = artifacts.require("XDEX");
const XHalflife = artifacts.require("XHalfLife");
const ONE = 10 ** 18;

contract("XHalflife", ([alice, bob, carol, minter]) => {
    beforeEach(async () => {
        this.xdex = await XDEX.new({ from: alice });
        this.halflife = await XHalflife.new({ from: minter });
    });

    it("should set correct state variables", async () => {
        const xdexCore = await this.xdex.core();
        assert.equal(xdexCore, alice);
    });

    context("should create streams successfully", async () => {
        beforeEach(async () => {
            await this.xdex.mint(alice, "200000000000000000000", { from: alice });
        });

        it("the token address should valid", async () => {
            await truffleAssert.reverts(
                this.halflife.createStream(
                    "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
                    bob,
                    "3000000000000000000000",
                    "300",
                    "5",
                    "100000000000000000",
                    { from: alice }
                ),
                truffleAssert.ErrorType.REVERT
            );
        });

        it("the sender should have enough tokens", async () => {
            const unlockRatio = "100000000000000000"; //0.1
            await this.xdex.approve(this.halflife.address, "3000", { from: alice });
            await truffleAssert.reverts(
                this.halflife.createStream(
                    this.xdex.address,
                    bob,
                    "3000000000000000000000",
                    "300",
                    "5",
                    unlockRatio,
                    { from: alice }
                ),
                truffleAssert.ErrorType.REVERT
            );
        });

        it("the recipient should not be the caller itself", async () => {
            const unlockRatio = "100000000000000000"; //0.1
            await truffleAssert.reverts(
                this.halflife.createStream(
                    this.xdex.address,
                    alice,
                    1000,
                    "30",
                    "10",
                    unlockRatio,
                    { from: alice }
                ),
                truffleAssert.ErrorType.REVERT
            );
        });

        it("the recipient should not be the 0 address", async () => {
            const recipient = "0x0000000000000000000000000000000000000000";
            const unlockRatio = "100000000000000000"; //0.1
            await truffleAssert.reverts(
                this.halflife.createStream(
                    this.xdex.address,
                    recipient,
                    1000,
                    "30",
                    "10",
                    unlockRatio,
                    {
                        from: alice,
                    }
                ),
                truffleAssert.ErrorType.REVERT
            );
        });

        it("the recipient should not be the halflife contract itself", async () => {
            const unlockRatio = "100000000000000000"; //0.1
            await truffleAssert.reverts(
                this.halflife.createStream(
                    this.xdex.address,
                    this.halflife.address,
                    1000,
                    "30",
                    "10",
                    unlockRatio,
                    { from: alice }
                ),
                truffleAssert.ErrorType.REVERT
            );
        });

        it("the halflife contract should have enough allowance", async () => {
            const deposit = 1001;
            const recipient = carol;
            const unlockRatio = "100000000000000000"; //0.1

            await this.xdex.approve(this.halflife.address, "1000", { from: alice });
            await truffleAssert.reverts(
                this.halflife.createStream(
                    this.xdex.address,
                    recipient,
                    deposit,
                    "30",
                    "10",
                    unlockRatio,
                    { from: alice }
                ),
                truffleAssert.ErrorType.REVERT
            );
        });

        it("should create stream successfully", async () => {
            let deposit = 100 * ONE;
            await this.xdex.approve(this.halflife.address, deposit.toString(), {
                from: alice,
            });

            let startBlock = 50;
            let kBlock = 10;
            const unlockRatio = "100000000000000000"; //0.1
            let result = await this.halflife.createStream(
                this.xdex.address,
                bob,
                deposit.toString(),
                startBlock,
                kBlock,
                unlockRatio,
                { from: alice }
            );
            let stream = await this.halflife.getStream(
                Number(result.logs[0].args.streamId)
            );

            //emits a stream event
            truffleAssert.eventEmitted(result, "StreamCreated");

            assert.equal(stream.token, this.xdex.address);
            assert.equal(stream.sender, alice);
            assert.equal(stream.recipient, bob);
            assert.equal(stream.depositAmount, deposit);
            assert.equal(stream.startBlock, startBlock);
            assert.equal(stream.kBlock, kBlock);
            assert.equal(stream.remaining, deposit);
            assert.equal(stream.withdrawable, 0);
            assert.equal(stream.lastRewardBlock, startBlock);

            //token transfered to the contract
            let balance = (
                await this.xdex.balanceOf(this.halflife.address)
            ).toString();
            assert.equal(balance, deposit);
            assert.equal(
                (await this.xdex.balanceOf(alice)).toString(),
                "100000000000000000000"
            );

            //increase next stream id
            const nextStreamId = await this.halflife.nextStreamId();
            assert.equal(nextStreamId, "2");

            //could withdraw after start bock
            await time.advanceBlockTo("105");
            let withdrawable = (
                await this.halflife.balanceOf("1")
            ).withdrawable.toString();
            assert.equal(withdrawable, "40951000000000000000");
        });

        it("should return balance of the stream", async () => {
            let deposit = 100 * ONE;
            const unlockRatio = "100000000000000000"; //0.1
            await this.xdex.approve(this.halflife.address, deposit.toString(), {
                from: alice,
            });
            await this.halflife.createStream(
                this.xdex.address,
                bob,
                deposit.toString(),
                "140",
                "5",
                unlockRatio,
                { from: alice }
            );

            await time.advanceBlockTo("135");
            //return sender balance of the stream
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                deposit.toString()
            );
            //return recipient balance of the stream
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "0"
            );

            await time.advanceBlockTo("155");
            //return sender balance of the stream
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "72900000000000000000"
            );
            //return recipient balance of the stream
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "27100000000000000000"
            );

            await time.advanceBlockTo("160");
            //return sender balance of the stream
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "65610000000000000000"
            );
            //return recipient balance of the stream
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "34390000000000000000"
            );
        });

        it("should withdraw from the stream", async () => {
            let deposit = 100 * ONE;
            const unlockRatio = "800000000000000000"; //0.8

            await this.xdex.approve(this.halflife.address, deposit.toString(), {
                from: alice,
            });
            await this.halflife.createStream(
                this.xdex.address,
                bob,
                deposit.toString(),
                "200",
                "10",
                unlockRatio,
                { from: alice }
            );

            await time.advanceBlockTo("201");
            await expectRevert(
                this.halflife.withdrawFromStream("1", "90000000000000000000000", {
                    from: bob,
                }),
                "amount exceeds the available balance"
            );

            await time.advanceBlockTo("210");

            assert.equal((await this.xdex.balanceOf(bob)).toString(), "0");
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "80000000000000000000"
            ); // block 210

            //bob withdraw 5 from halflife
            let result = await this.halflife.withdrawFromStream(
                "1",
                "5000000000000000000",
                { from: bob }
            ); // block 211

            //emits a WithdrawFromStream event
            truffleAssert.eventEmitted(result, "WithdrawFromStream");

            //decreases bob's balance in stream
            assert.equal(
                (await this.xdex.balanceOf(bob)).toString(),
                "5000000000000000000"
            ); // block 211

            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "75000000000000000000"
            );

            //remainingBalance should be zero when withdrawn in full
            await time.advanceBlockTo("290");

            await this.halflife.withdrawFromStream("1", "90000000000000000000", {
                from: bob,
            });
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "0"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "4999948800000000000"
            ); //4.9999
        });

        it("should cancel the stream", async () => {
            await expectRevert(
                this.halflife.cancelStream("10", { from: bob }),
                "stream does not exist"
            );

            let deposit = 100 * ONE;
            const unlockRatio = "200000000000000000"; //0.2

            await time.advanceBlockTo("299");
            await this.xdex.approve(this.halflife.address, deposit.toString(), {
                from: alice,
            });
            await this.halflife.createStream(
                this.xdex.address,
                bob,
                deposit.toString(),
                "350",
                "5",
                unlockRatio,
                { from: alice }
            );

            assert.equal(
                (await this.xdex.balanceOf(alice)).toString(),
                "100000000000000000000"
            );
            assert.equal((await this.xdex.balanceOf(bob)).toString(), "0");

            await time.advanceBlockTo("359");
            let result = await this.halflife.cancelStream("1", { from: bob }); // block 360

            //emits a cancel event
            truffleAssert.eventEmitted(result, "StreamCanceled");

            //transfer tokens to the stream sender and recipient
            assert.equal(
                (await this.xdex.balanceOf(bob)).toString(),
                "36000000000000000000"
            );
            assert.equal(
                (await this.xdex.balanceOf(alice)).toString(),
                "164000000000000000000"
            );
        });

        it("should fund to stream", async () => {
            let deposit = 100 * ONE;
            const unlockRatio = "800000000000000000"; //0.8

            await time.advanceBlockTo("399");
            await this.xdex.approve(this.halflife.address, "200000000000000000000", {
                from: alice,
            });
            await this.halflife.createStream(
                this.xdex.address,
                bob,
                deposit.toString(),
                "410",
                "10",
                unlockRatio,
                { from: alice }
            );
            assert.equal(
                (await this.xdex.balanceOf(alice)).toString(),
                "100000000000000000000"
            );
            assert.equal((await this.xdex.balanceOf(bob)).toString(), "0");

            await time.advanceBlockTo("419");
            await this.halflife.fundStream("1", "10000000000000000000", {
                from: alice,
            });

            //the remaing amount should be: (deposit - unlocked + fund) = 100 - 100*(0.8^1) + 10 = 30
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "30000000000000000000"
            );
            //bob's withdrawable amount: 100*(0.8^1) = 80
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "80000000000000000000"
            );

            await time.advanceBlockTo("424");
            await this.halflife.fundStream("1", "80000000000000000000", {
                from: alice,
            });
            //alice balance = 200 - 100 - 10 - 80 = 10
            assert.equal(
                (await this.xdex.balanceOf(alice)).toString(),
                "10000000000000000000"
            );

            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "80000000000000000000"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "110000000000000000000"
            );

            await time.advanceBlockTo("430");
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "168000000000000000000"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "22000000000000000000"
            );

            await time.advanceBlockTo("440");
            await this.halflife.withdrawFromStream("1", "2000000000000000000", {
                from: bob,
            });
            assert.equal(
                (await this.xdex.balanceOf(bob)).toString(),
                "2000000000000000000"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "183600000000000000000"
            ); //183.6
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "4400000000000000000"
            );

            await time.advanceBlockTo("455");
            await this.halflife.fundStream("1", "3000000000000000000", {
                from: alice,
            });
            //alice balance = 10 - 3 = 7
            assert.equal(
                (await this.xdex.balanceOf(alice)).toString(),
                "7000000000000000000"
            );
            let stream = await this.halflife.getStream("1");
            assert.equal(stream.lastRewardBlock.toString(), "450");
            assert.equal(stream.depositAmount.toString(), "193000000000000000000"); //100 + 10 + 80 + 3 = 193
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "187120000000000000000"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "3880000000000000000"
            ); //3.88
        });
    });
});
