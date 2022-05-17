// [assignment] please copy the entire modified custom.test.js here
const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils, Wallet } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.05')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('Custom Tests', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig }
  }

  it('[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances', async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    const aliceKeypair = new Keypair()

    expect(await token.balanceOf(tornadoPool.address)).to.equal(0)

    const aliceDepositAmount = utils.parseEther('0.1')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })

    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    })

    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceDepositUtxo.amount,
      onTokenBridgedData,
    )
    await token.transfer(omniBridge.address, aliceDepositAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

    expect(await token.balanceOf(omniBridge.address)).to.equal(aliceDepositAmount)

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data },
      { who: tornadoPool.address, callData: onTokenBridgedTx.data },
    ])

    const aliceWithdrawAmount = utils.parseEther('0.08')
    const aliceWithdrawUtxo = new Utxo({
      amount: aliceDepositAmount.sub(aliceWithdrawAmount),
      keypair: aliceKeypair,
    })

    expect(await token.balanceOf(tornadoPool.address)).to.equal(aliceDepositAmount)

    const aliceAddress = Wallet.createRandom().address
    await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo],
      outputs: [aliceWithdrawUtxo],
      recipient: aliceAddress,
    })

    expect(await token.balanceOf(aliceAddress)).to.equal(aliceWithdrawAmount)
    expect(await token.balanceOf(omniBridge.address)).to.equal(0)
    expect(await token.balanceOf(tornadoPool.address)).to.equal(aliceDepositAmount.sub(aliceWithdrawAmount))
  })

  it('[assignment] iii. see assignment doc for details', async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    const aliceKeypair = new Keypair()
    const bobKeypair = new Keypair()

    expect(await token.balanceOf(tornadoPool.address)).to.equal(0)

    const aliceDepositAmount = utils.parseEther('0.13')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })

    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    })

    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceDepositUtxo.amount,
      onTokenBridgedData,
    )
    await token.transfer(omniBridge.address, aliceDepositAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

    expect(await token.balanceOf(omniBridge.address)).to.equal(aliceDepositAmount)

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data },
      { who: tornadoPool.address, callData: onTokenBridgedTx.data },
    ])

    const bobSendAmount = utils.parseEther('0.06')
    const aliceTransferUtxo = new Utxo({
      amount: aliceDepositAmount.sub(bobSendAmount),
      keypair: aliceKeypair,
    })
    const bobSendUtxo = new Utxo({
      amount: bobSendAmount,
      keypair: bobKeypair,
    })
    await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo],
      outputs: [aliceTransferUtxo, bobSendUtxo],
    })

    const bobWithdrawUtxo = new Utxo({
      amount: 0,
      keypair: bobKeypair,
    })
    const bobAddress = Wallet.createRandom().address
    await transaction({
      tornadoPool,
      inputs: [bobSendUtxo],
      outputs: [bobWithdrawUtxo],
      recipient: bobAddress,
    })

    const aliceWithdrawUtxo = new Utxo({
      amount: 0,
      keypair: aliceKeypair,
    })
    const aliceAddress = Wallet.createRandom().address
    await transaction({
      tornadoPool,
      inputs: [aliceTransferUtxo],
      outputs: [aliceWithdrawUtxo],
      recipient: aliceAddress,
      isL1Withdrawal: true,
    })

    expect(await token.balanceOf(bobAddress)).to.equal(bobSendAmount)
    expect(await token.balanceOf(omniBridge.address)).to.equal(aliceDepositAmount.sub(bobSendAmount))
    expect(await token.balanceOf(tornadoPool.address)).to.equal(0)
  })
})
