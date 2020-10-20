const { expectRevert } = require('@openzeppelin/test-helpers');
const XDEX = artifacts.require('XDEX');

contract('XDEX', ([alice, bob, carol]) => {
    beforeEach(async () => {
        this.xdex = await XDEX.new({ from: alice });
        this.xdex.addMinter(alice, { from: alice });
    });

    it('should have correct name and symbol and decimal', async () => {
        const name = await this.xdex.name();
        const symbol = await this.xdex.symbol();
        const decimals = await this.xdex.decimals();
        assert.equal(name.valueOf(), 'XDEFI Governance Token');
        assert.equal(symbol.valueOf(), 'XDEX');
        assert.equal(decimals.valueOf(), '18');
    });

    it('should only allow owner to mint token', async () => {
        await this.xdex.mint(alice, '100', { from: alice });
        await this.xdex.mint(bob, '1000', { from: alice });
        await expectRevert(
            this.xdex.mint(carol, '1000', { from: bob }),
            'Not Authorized',
        );
        const totalSupply = await this.xdex.totalSupply();
        const aliceBal = await this.xdex.balanceOf(alice);
        const bobBal = await this.xdex.balanceOf(bob);
        const carolBal = await this.xdex.balanceOf(carol);
        assert.equal(totalSupply.valueOf(), '1100');
        assert.equal(aliceBal.valueOf(), '100');
        assert.equal(bobBal.valueOf(), '1000');
        assert.equal(carolBal.valueOf(), '0');
    });

    it('should supply token transfers properly', async () => {
        await this.xdex.mint(alice, '100', { from: alice });
        await this.xdex.mint(bob, '1000', { from: alice });
        await this.xdex.transfer(carol, '10', { from: alice });
        await this.xdex.transfer(carol, '100', { from: bob });
        const totalSupply = await this.xdex.totalSupply();
        const aliceBal = await this.xdex.balanceOf(alice);
        const bobBal = await this.xdex.balanceOf(bob);
        const carolBal = await this.xdex.balanceOf(carol);
        assert.equal(totalSupply.valueOf(), '1100');
        assert.equal(aliceBal.valueOf(), '90');
        assert.equal(bobBal.valueOf(), '900');
        assert.equal(carolBal.valueOf(), '110');
    });

    it('should fail if you try to do bad transfers', async () => {
        await this.xdex.mint(alice, '100', { from: alice });
        await expectRevert(
            this.xdex.transfer(carol, '110', { from: alice }),
            'ERC20: transfer amount exceeds balance',
        );
        await expectRevert(
            this.xdex.transfer(carol, '1', { from: bob }),
            'ERC20: transfer amount exceeds balance',
        );
    });
});