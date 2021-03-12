const { expectRevert } = require('@openzeppelin/test-helpers');
const truffleAssert = require("truffle-assertions");
const Timelock = artifacts.require('TimelockHarness');
const {
    encodeParameters,
    etherUnsigned,
    freezeTime,
    keccak256
} = require('./Utils/Ethereum');

const twoDays = etherUnsigned(2 * 24 * 60 * 60);
const zero = etherUnsigned(0);

contract('TIMELOCK', ([alice, bob, carol]) => {
    let blockTimestamp = etherUnsigned(100);
    let delay = twoDays;
    let newDelay = delay.mul(2);
    let eta;
    let value = zero;
    let signature = 'setDelay(uint256)';
    let data = encodeParameters(['uint256'], [newDelay]);
    let queuedTxHash;
    let timestamp;
    let gracePeriod = etherUnsigned(7 * 24 * 60 * 60);

    beforeEach(async () => {
        this.timelock = await Timelock.new(alice, delay, { from: alice });

        await freezeTime(blockTimestamp.toNumber())
        eta = blockTimestamp.add(delay);

        queuedTxHash = keccak256(
            encodeParameters(
                ['address', 'uint256', 'string', 'bytes', 'uint256'],
                [this.timelock.address, value, signature, data, eta]
            )
        );
    });

    it("should get correct state variables", async () => {
        const admin = await this.timelock.admin();
        assert.equal(admin, alice);

        const timelockDelay = await this.timelock.delay();
        assert.equal(timelockDelay, delay.toString());
    });


    context("should set delay and set admin successfully", async () => {
        it("msg.sender should be Timelock", async () => {
            await truffleAssert.reverts(
                this.timelock.setDelay(delay, { from: alice }),
                "Timelock::setDelay: Call must come from Timelock."
            );

            await truffleAssert.reverts(
                this.timelock.setPendingAdmin(bob, { from: alice }),
                "Timelock::setPendingAdmin: Call must come from Timelock."
            );

            await truffleAssert.reverts(
                this.timelock.acceptAdmin({ from: bob }),
                "Timelock::acceptAdmin: Call must come from pendingAdmin."
            );
        });

        it("should accept admin", async () => {
            await this.timelock.harnessSetPendingAdmin(bob, { from: alice });

            let pendingAdminBefore = await this.timelock.pendingAdmin();
            assert.equal(bob, pendingAdminBefore);

            const result = await this.timelock.acceptAdmin({ from: bob });

            let pendingAdminAfter = await this.timelock.pendingAdmin();
            assert.equal('0x0000000000000000000000000000000000000000', pendingAdminAfter);

            const admin = await this.timelock.admin();
            assert.equal(admin, bob);

            truffleAssert.eventEmitted(result, "NewAdmin");
        });
    });

    context("should queue and cancle transaction successfully", async () => {
        it("msg.sender should be admin and delay is valid", async () => {
            await truffleAssert.reverts(
                this.timelock.queueTransaction(this.timelock.address, value, signature, data, eta, { from: carol }),
                "Timelock::queueTransaction: Call must come from admin."
            );

            const etaLessThanDelay = blockTimestamp.add(delay).sub(1);
            await truffleAssert.reverts(
                this.timelock.queueTransaction(this.timelock.address, value, signature, data, etaLessThanDelay, { from: alice }),
                "Timelock::queueTransaction: Estimated execution block must satisfy delay."
            );
        });

        it("should sets hash as true", async () => {
            const queueTransactionsHashValueBefore = await this.timelock.queuedTransactions(queuedTxHash);
            assert.equal(queueTransactionsHashValueBefore, false);

            timestamp = await this.timelock.getBlockTimestamp();

            eta = timestamp + delay;
            queuedTxHash = keccak256(
                encodeParameters(
                    ['address', 'uint256', 'string', 'bytes', 'uint256'],
                    [this.timelock.address, value, signature, data, eta]
                )
            );

            const result = await this.timelock.queueTransaction(this.timelock.address, value, signature, data, eta, { from: alice });

            const queueTransactionsHashValueAfter = await this.timelock.queuedTransactions(queuedTxHash);
            assert.equal(queueTransactionsHashValueAfter, true);

            truffleAssert.eventEmitted(result, "QueueTransaction");
        });

        it("should cancel transactions successfully", async () => {
            timestamp = await this.timelock.getBlockTimestamp();

            eta = timestamp + delay;
            queuedTxHash = keccak256(
                encodeParameters(
                    ['address', 'uint256', 'string', 'bytes', 'uint256'],
                    [this.timelock.address, value, signature, data, eta]
                )
            );

            await this.timelock.queueTransaction(this.timelock.address, value, signature, data, eta, { from: alice });

            const result = await this.timelock.cancelTransaction(this.timelock.address, value, signature, data, eta, { from: alice });
            truffleAssert.eventEmitted(result, "CancelTransaction");

            const txHash = await this.timelock.queuedTransactions(queuedTxHash);
            assert.equal(txHash, false);
        });
    });

    context("should execute transaction successfully", async () => {
        beforeEach(async () => {
            // Queue transaction that will succeed
            timestamp = await this.timelock.getBlockTimestamp();
            eta = parseInt(timestamp.toString()) + delay.toNumber();
            queuedTxHash = keccak256(
                encodeParameters(
                    ['address', 'uint256', 'string', 'bytes', 'uint256'],
                    [this.timelock.address, value, signature, data, eta]
                )
            );
            await this.timelock.queueTransaction(this.timelock.address, value, signature, data, eta, { from: alice });
        });

        it('requires timestamp to be greater than or equal to eta', async () => {
            await truffleAssert.reverts(
                this.timelock.executeTransaction(this.timelock.address, value, signature, data, eta, { from: alice }),
                "Timelock::executeTransaction: Transaction hasn't surpassed time lock."
            );

            let freeze = parseInt(timestamp.toString()) + delay.toNumber() + gracePeriod.toNumber();
            await freezeTime(freeze + 1);

            await truffleAssert.reverts(
                this.timelock.executeTransaction(this.timelock.address, value, signature, data, eta, { from: alice }),
                "Timelock::executeTransaction: Transaction hasn't surpassed time lock."
            );
        });

        // it("should execute transaction, updates delay and emits event successfully", async () => {
        //     const timelockDelay = await this.timelock.delay();
        //     assert.equal(timelockDelay, delay.toString());

        //     const txHashValue = await this.timelock.queuedTransactions(queuedTxHash);
        //     assert.equal(txHashValue, true);

        //     let freeze = delay.mul(2).toNumber();
        //     await freezeTime(parseInt((freeze.toString())));

        //     await this.timelock.executeTransaction(this.timelock.address, value, signature, data, eta, { from: alice });

        //     txHashValue = await this.timelock.queuedTransactions(queuedTxHash);
        //     assert.equal(txHashValue, false);

        //     timelockDelay = await this.timelock.delay();
        //     assert.equal(timelockDelay, newDelay.toString());

        //     truffleAssert.eventEmitted(result, "ExecuteTransaction");

        //     truffleAssert.eventEmitted(result, "NewDelay");
        // });
    });

});