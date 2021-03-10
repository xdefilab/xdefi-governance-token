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
            const unlockRatio = "100"; //0.1
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
            const unlockRatio = "100"; //0.1
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
            const unlockRatio = "100"; //0.1
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
            const unlockRatio = "100"; //0.1
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
            const unlockRatio = "100"; //0.1
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
            assert.equal(withdrawable, "43981199933355268200");//44.0
        });

        it("should return balance of the stream", async () => {
            let deposit = 100 * ONE;
            const unlockRatio = "100"; //0.1
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
            const unlockRatio = "800"; //0.8

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
                "77973201542924783600"
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
                "4999956411395949888"
            ); //4.9999
        });

        it("should cancel the stream", async () => {
            await expectRevert(
                this.halflife.cancelStream("10", { from: bob }),
                "stream does not exist"
            );

            let deposit = 100 * ONE;
            const unlockRatio = "200"; //0.2

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

        it("should fund to stream for xdex famr vesting", async () => {
            let deposit = 100 * ONE;
            const unlockRatio = "800"; //0.8

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
            //fund 10
            await this.halflife.lazyFundStream("1", "10000000000000000000", {
                from: alice,
            });

            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "27070144322204598275"
            );
            //bob's withdrawable amount: 80
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "82929855677795401725"
            );

            await time.advanceBlockTo("424");
            //fund 80
            await this.halflife.lazyFundStream("1", "80000000000000000000", {
                from: alice,
            });
            //alice balance should be 200 - 100 - 10 - 80 = 10
            assert.equal(
                (await this.xdex.balanceOf(alice)).toString(),
                "10000000000000000000"
            );

            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "109710168059140152240"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "80289831940859847760"
            );

            await time.advanceBlockTo("430");
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "154093295552434905780"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "35906704447565094220"
            );

            await time.advanceBlockTo("439");
            //block 440, withdraw 2
            await this.halflife.withdrawFromStream("1", "2000000000000000000", {
                from: bob,
            });

            await time.advanceBlockTo("441");
            assert.equal(
                (await this.xdex.balanceOf(bob)).toString(),
                "2000000000000000000"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "181886237801135428475"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "6113762198864571525"
            );

            await time.advanceBlockTo("454");
            //block 455, fund 3
            await this.halflife.lazyFundStream("1", "3000000000000000000", {
                from: alice,
            });
            //alice balance = 10 - 3 = 7
            assert.equal(
                (await this.xdex.balanceOf(alice)).toString(),
                "7000000000000000000"
            );
            let stream = await this.halflife.getStream("1");
            assert.equal(stream.lastRewardBlock.toString(), "455");
            assert.equal(stream.depositAmount.toString(), "193000000000000000000");
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "188573424853818397806"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "2426575146181602194"
            );
        });

        it("should simple fund to stream for general purpose", async () => {
            let deposit = 100 * ONE;
            const unlockRatio = "800"; //0.8

            await time.advanceBlockTo("499");
            await this.xdex.approve(this.halflife.address, "200000000000000000000", {
                from: alice,
            });
            await this.halflife.createStream(
                this.xdex.address,
                bob,
                deposit.toString(),
                "510",
                "10",
                unlockRatio,
                { from: alice }
            );
            assert.equal(
                (await this.xdex.balanceOf(alice)).toString(),
                "100000000000000000000"
            );
            assert.equal((await this.xdex.balanceOf(bob)).toString(), "0");

            await time.advanceBlockTo("519");
            //fund 10
            await this.halflife.singleFundStream("1", "10000000000000000000", {
                from: alice,
            });

            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "30000000000000000000"
            );
            //bob's withdrawable amount: 80
            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "80000000000000000000"
            );

            await time.advanceBlockTo("524");
            //fund 80
            await this.halflife.singleFundStream("1", "80000000000000000000", {
                from: alice,
            });
            //alice balance should be 200 - 100 - 10 - 80 = 10
            assert.equal(
                (await this.xdex.balanceOf(alice)).toString(),
                "10000000000000000000"
            );

            assert.equal(
                (await this.halflife.balanceOf("1")).withdrawable.toString(),
                "96583592126330501840"
            );
            assert.equal(
                (await this.halflife.balanceOf("1")).remaining.toString(),
                "93416407873669498160"
            );
        });
    });
});
