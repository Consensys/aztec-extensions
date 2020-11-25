// tslint:disable:no-console
import { proofs } from "@aztec/dev-utils"
import secp256k1 from "@aztec/secp256k1"
import {
    BurnProof,
    JoinSplitProof,
    MintProof,
    note,
    PrivateRangeProof,
    PublicRangeProof,
    SwapProof,
} from "aztec.js"
import { Signer } from "ethers"
import { AZTEC_JS_METADATA_PREFIX_LENGTH } from "../chain/aztec/constants"
import AceMigator from "../chain/migration/1_ace"
import SimpleTokenMigator from "../chain/migration/2_simpleToken"
import ZkAssetDirectMigrator from "../chain/migration/3_zkAssetDirect"
import ZkAssetLinkedMigrator from "../chain/migration/4_zkAssetLinked"
import migratorFactory, { Migrator } from "../chain/migration/migrator"
import { ACE, SimpleToken, ZkAsset, ZkAssetDirect } from "../chain/types"
import { zeroAddress } from "../chain/utils/addresses"
import { WalletSigner } from "../chain/wallet/WalletSigner"
import configPromise from "../config/index"
import { EthersMatchers } from "../utils/jest"
import {
    bytes,
    bytes32,
    bytesFixed,
    ethereumAddress,
    transactionHash,
} from "../utils/regEx"

jest.setTimeout(60000) // timeout for each test in milliseconds
// Extend the Jest matchers with Ethers BigNumber matchers like toEqualBN
expect.extend(EthersMatchers)

// 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
const deployer = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000001"
)

const issuer = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000002"
)
const provider1 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000003"
)
const provider2 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000004"
)
const agent = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000005"
)
const agentClient1 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000006"
)

describe("Mint, transfer, burn, deposit and withdrawal of  assets", () => {
    let aceContract: ACE
    let cbAce: ACE
    let migrator: Migrator
    let issuerSigner: Signer
    let provider1Signer: Signer
    let provider2Signer: Signer
    let agentSigner: Signer

    beforeAll(async () => {
        const config = await configPromise
        if (!config?.chain?.wallet) {
            throw Error(`Failed to load config for chain.wallet.`)
        }
        const deployerWallet = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: deployer.privateKey,
        })
        migrator = await migratorFactory(deployerWallet)
        issuerSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: issuer.privateKey,
        })
        provider1Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: provider1.privateKey,
        })
        provider2Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: provider2.privateKey,
        })
        agentSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: agent.privateKey,
        })
    })

    test("Deploy proof contracts and ACE", async () => {
        aceContract = await AceMigator(migrator)
        expect(aceContract.address).toMatch(ethereumAddress)
        expect(await aceContract.latestEpoch()).toEqual(1)
        expect(
            await aceContract.getValidatorAddress(proofs.JOIN_SPLIT_PROOF)
        ).toMatch(ethereumAddress)
        cbAce = aceContract.connect(issuerSigner)
    })

    describe("Shield ERC20 contract", () => {
        let zkAsset: ZkAsset
        let issuerZkAsset: ZkAsset
        let provider1ZkAsset: ZkAsset
        let provider2ZkAsset: ZkAsset
        let simpleToken: SimpleToken

        test("Deploy Simple ERC20 token", async () => {
            simpleToken = await SimpleTokenMigator(migrator)
            expect(simpleToken.address).toMatch(ethereumAddress)
            expect(simpleToken).not.toEqual(aceContract.address)
            const deployedCOntract = await simpleToken.deployed()
            expect(deployedCOntract.address).toEqual(simpleToken.address)
        })

        const initialDeposit = 1000000
        test("Deployer mint tokens for Issuer", async () => {
            expect(await simpleToken.totalSupply()).toEqualBN(0)
            expect(await simpleToken.balanceOf(issuer.address)).toEqualBN(0)

            const tx = await simpleToken.mint(issuer.address, initialDeposit)
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)

            expect(await simpleToken.totalSupply()).toEqualBN(initialDeposit)
            expect(await simpleToken.balanceOf(issuer.address)).toEqualBN(
                initialDeposit
            )
        })

        test("Deploy a zero-knowledge asset linked to token", async () => {
            zkAsset = await ZkAssetLinkedMigrator(
                migrator,
                aceContract.address,
                simpleToken.address
            )
            expect(zkAsset.address).toMatch(ethereumAddress)
            issuerZkAsset = zkAsset.connect(issuerSigner)
            provider1ZkAsset = zkAsset.connect(provider1Signer)
            provider2ZkAsset = zkAsset.connect(provider2Signer)

            // Check the zk asset is registered in the ACE note registry
            const registry = await aceContract.getRegistry(zkAsset.address)
            expect(registry.linkedToken).toEqual(simpleToken.address)
            expect(registry.scalingFactor).toEqualBN(1)
            expect(registry.totalSupplemented).toEqualBN(0)
            expect(registry.totalSupply).toEqualBN(0)
        })

        test("Issuer approves the ACE contract to spend their tokens for a deposit", async () => {
            const allowanceForDeposit = 20000
            const cbSimpleToken = simpleToken.connect(issuerSigner)
            const tx = await cbSimpleToken.approve(
                aceContract.address,
                allowanceForDeposit
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(
                await simpleToken.allowance(issuer.address, aceContract.address)
            ).toEqualBN(allowanceForDeposit)
        })

        const firstDepositAmount = 3000
        let issuerNote1: note
        test("Issuer deposits tokens to a zero-knowledge note they own", async () => {
            // construct JoinSplit proof for the Issuer deposit
            issuerNote1 = await note.create(
                issuer.publicKey,
                firstDepositAmount
            )
            expect(issuerNote1.owner).toEqual(issuer.address)
            expect(issuerNote1.k.toNumber()).toEqual(firstDepositAmount)
            const sendProof = new JoinSplitProof(
                [], // input notes
                [issuerNote1], // output notes
                issuer.address, // tx sender
                firstDepositAmount * -1, // public token deposit amount (negative)
                issuer.address // public token owner
            )
            const proofData = sendProof.encodeABI(issuerZkAsset.address)

            // Issuer approves the zero-knowledge asset to transfer from ACE
            const approveTx = await cbAce.publicApprove(
                zkAsset.address,
                sendProof.hash,
                firstDepositAmount
            )
            const approveReceipt = await approveTx.wait()
            expect(approveReceipt.status).toEqual(1)

            // deposit tokens into zero-knowledge asset owner by the Issuer
            const tx = await issuerZkAsset["confidentialTransfer(bytes,bytes)"](
                proofData,
                []
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)

            // check the public token balances
            expect(await simpleToken.totalSupply()).toEqualBN(initialDeposit)
            expect(await simpleToken.balanceOf(issuer.address)).toEqualBN(
                initialDeposit - firstDepositAmount
            )
            expect(await simpleToken.balanceOf(aceContract.address)).toEqualBN(
                firstDepositAmount
            )

            // check the registry balances
            const registry = await aceContract.getRegistry(zkAsset.address)
            expect(registry.totalSupply).toEqualBN(firstDepositAmount)
            expect(registry.totalSupplemented).toEqualBN(0)
        })

        const secondDepositAmount = 300
        test("Issuer deposits tokens to multiple zero-knowledge notes owned by others", async () => {
            // construct JoinSplit proof for the Issuer deposit
            const provider1Note1 = await note.create(provider1.publicKey, 100)
            const provider2Note1 = await note.create(provider2.publicKey, 200)
            const agentNote1 = await note.create(agent.publicKey, 0)
            const sendProof = new JoinSplitProof(
                [], // input notes
                [provider1Note1, provider2Note1, agentNote1], // output notes
                issuer.address, // tx sender
                secondDepositAmount * -1, // public token deposit amount (negative)
                issuer.address // public token owner
            )
            const proofData = sendProof.encodeABI(issuerZkAsset.address)
            const proofSignatures = sendProof.constructSignatures(
                issuerZkAsset.address,
                [] // there is no input owners
            )

            // Issuer approves the zero-knowledge asset to transfer from ACE
            const approveTx = await cbAce.publicApprove(
                zkAsset.address,
                sendProof.hash,
                secondDepositAmount
            )
            const approveReceipt = await approveTx.wait()
            expect(approveReceipt.status).toEqual(1)

            // deposit tokens into zero-knowledge asset owner by the Issuer
            const tx = await issuerZkAsset["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)

            // check the public token balances
            expect(await simpleToken.totalSupply()).toEqualBN(initialDeposit)
            expect(await simpleToken.balanceOf(issuer.address)).toEqualBN(
                initialDeposit - (firstDepositAmount + secondDepositAmount)
            )
            expect(await simpleToken.balanceOf(aceContract.address)).toEqualBN(
                firstDepositAmount + secondDepositAmount
            )

            // check the registry balances
            const registry = await aceContract.getRegistry(zkAsset.address)
            expect(registry.totalSupply).toEqualBN(
                firstDepositAmount + secondDepositAmount
            )
            expect(registry.totalSupplemented).toEqualBN(0)
        })

        test("Issuer withdraws note to linked ERC20 token", async () => {
            const withdrawalAmount = issuerNote1.k.toNumber()
            const proof = new JoinSplitProof(
                [issuerNote1], // input notes
                [], // output notes
                issuer.address, // tx sender
                withdrawalAmount, // public token withdrawal amount (positive)
                issuer.address // public token owner
            )
            const proofData = proof.encodeABI(issuerZkAsset.address)
            const proofSignatures = proof.constructSignatures(
                zkAsset.address,
                [issuer] // there is no input owners
            )

            // Issuer approves the zero-knowledge asset to transfer from ACE
            const approveTx = await cbAce.publicApprove(
                zkAsset.address,
                proof.hash,
                withdrawalAmount
            )
            const approveReceipt = await approveTx.wait()
            expect(approveReceipt.status).toEqual(1)

            // deposit tokens into zero-knowledge asset owner by the Issuer
            const tx = await issuerZkAsset["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)

            // check the public token balances
            expect(await simpleToken.totalSupply()).toEqualBN(initialDeposit)
            expect(await simpleToken.balanceOf(issuer.address)).toEqualBN(
                initialDeposit -
                    (firstDepositAmount + secondDepositAmount) +
                    withdrawalAmount
            )
            expect(await simpleToken.balanceOf(aceContract.address)).toEqualBN(
                firstDepositAmount + secondDepositAmount - withdrawalAmount
            )
        })
    })

    describe("Direct ZkAsset", () => {
        let zkAsset: ZkAssetDirect
        let issuerZkAsset: ZkAssetDirect
        let provider1ZkAsset: ZkAssetDirect
        let provider2ZkAsset: ZkAssetDirect
        let registry

        test("Deploy a zero-knowledge direct asset", async () => {
            zkAsset = await ZkAssetDirectMigrator(migrator, aceContract.address)
            expect(zkAsset.address).toMatch(ethereumAddress)
            issuerZkAsset = zkAsset.connect(issuerSigner)
            provider1ZkAsset = zkAsset.connect(provider1Signer)
            provider2ZkAsset = zkAsset.connect(provider2Signer)

            registry = await aceContract.getRegistry(zkAsset.address)
            expect(registry.linkedToken).toEqual(
                "0x0000000000000000000000000000000000000000"
            )
            expect(registry.scalingFactor).toEqualBN(1)
            expect(registry.totalSupplemented).toEqualBN(0)
            expect(registry.totalSupply).toEqualBN(0)
            expect(registry.canAdjustSupply).toBeTruthy()
            expect(registry.canConvert).toBeFalsy()
        })

        let issuerNote1
        let issuerNote2
        const issuerNote1Value = 2000
        describe("Mint", () => {
            let issuerNote1Receipt
            test("Deployer mints Issuer note 1", async () => {
                issuerNote1 = await note.create(
                    issuer.publicKey,
                    issuerNote1Value
                )
                console.log(
                    `Issuer note 1 meta data:\n` +
                        `ephemeral key: ${issuerNote1.exportEphemeralKey()}\n` +
                        `note public key ${issuerNote1.getPublic()}\n` +
                        `view key: ${issuerNote1.getView()}\n` +
                        `owner: ${issuerNote1.owner}\n` +
                        `value (k): ${issuerNote1.k.toString()}\n` +
                        `a: ${issuerNote1.a.toString()}`
                )
                expect(issuerNote1.owner).toEqual(issuer.address)
                expect(issuerNote1.k.toNumber()).toEqual(issuerNote1Value)

                const zeroMintCounterNote = await note.createZeroValueNote()
                expect(zeroMintCounterNote.k.toNumber()).toEqual(0)

                const mintProof = new MintProof(
                    zeroMintCounterNote, // previous sum of all notes
                    issuerNote1, // new sum of all notes
                    [issuerNote1], // new minted notes
                    deployer.address // sender
                )

                const mintData = mintProof.encodeABI()

                const tx = await zkAsset.confidentialMint(
                    proofs.MINT_PROOF,
                    mintData
                )
                expect(tx.hash).toMatch(transactionHash)
                issuerNote1Receipt = await tx.wait()
                expect(issuerNote1Receipt.status).toEqual(1)

                // These are zero as there is no linked token contract in a direct zkAsset
                expect(registry.totalSupplemented).toEqualBN(0)
                expect(registry.totalSupply).toEqualBN(0)
            })

            test("Check on-chain Issuer note 1", async () => {
                const onChainNote = await cbAce.getNote(
                    issuerZkAsset.address,
                    issuerNote1.noteHash
                )
                expect(onChainNote.status).toEqual(1) // unspent
                expect(onChainNote.noteOwner).toEqual(issuer.address)
            })

            test("Check mint transaction events", () => {
                expect(issuerNote1Receipt.events).toHaveLength(2)
                expect(issuerNote1Receipt.events[0].event).toEqual("CreateNote")
                expect(issuerNote1Receipt.events[1].event).toEqual(
                    "UpdateTotalMinted"
                )
                expect(issuerNote1Receipt.events[0].args.owner).toEqual(
                    issuer.address
                )
                expect(issuerNote1Receipt.events[0].args.noteHash).toEqual(
                    issuerNote1.noteHash
                )
                expect(issuerNote1Receipt.events[0].args.metadata).toMatch(
                    bytes
                )
                expect(
                    issuerNote1Receipt.events[0].args.metadata.slice(
                        AZTEC_JS_METADATA_PREFIX_LENGTH
                    )
                ).toEqual(issuerNote1.metaData.slice(2))
            })

            test("Create Issuer note 1 from emitted metadata", async () => {
                const mintEventMetadata =
                    issuerNote1Receipt.events[0].args.metadata
                const mintedNote = await note.fromEventLog(
                    mintEventMetadata,
                    issuer.privateKey
                )
                expect(mintedNote.noteHash).toEqual(issuerNote1.noteHash)
                // expect(mintedNote.metaData).toEqual(mintEventMetadata)
                expect(mintedNote.k.toNumber()).toEqual(issuerNote1Value)
                expect(mintedNote.owner).toEqual(issuer.address)
            })

            test("Deployer mints 200 note to Provider 2, zero value notes for other participants", async () => {
                issuerNote2 = await note.create(issuer.publicKey, 0)
                const provider1Note0 = await note.create(provider1.publicKey, 0)
                const provider2Note0 = await note.create(
                    provider2.publicKey,
                    200
                )
                const agentNote0 = await note.create(agent.publicKey, 0)
                const newTotalValueNote2 = await note.create(
                    deployer.publicKey,
                    2200
                )

                const mintProof = new MintProof(
                    issuerNote1,
                    newTotalValueNote2,
                    [issuerNote2, provider1Note0, provider2Note0, agentNote0],
                    deployer.address
                )

                const mintData = mintProof.encodeABI()

                const tx = await zkAsset.confidentialMint(
                    proofs.MINT_PROOF,
                    mintData
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })
        })

        describe("Public range proofs of first Issuer note", () => {
            // See PublicRangeProof66563 API for parameter details https://aztecprotocol.github.io/AZTEC/PublicRangeProof66563.html
            test("CB note value >= 1990, proof sent by Issuer", async () => {
                // note value less the public comparison value. 2000 - 1990 = 10
                const utilityNote = await note.create(issuer.publicKey, 10)
                const publicRangeProof = new PublicRangeProof(
                    issuerNote1, // originalNote being compared
                    1990, // publicComparison value
                    issuer.address, // sender of the proof
                    true, // true note value is greater than public value. false note value is less than public value
                    utilityNote, // a note with different between the note value and the public comparison value.
                    true // safeguard flag to turn on a balancing check prior to construction of proof
                )
                expect(
                    publicRangeProof.checkBalancingRelationShipSatisfied()
                ).toBeUndefined()
            })
            test("CB note value <= 4020, proof sent by Issuer", async () => {
                const utilityNote = await note.create(issuer.publicKey, 4020)
                expect(utilityNote.k.toNumber()).toEqual(4020)
                const publicRangeProof = new PublicRangeProof(
                    issuerNote1, // original note value is 2000
                    2020, // public comparison is > original note value of 2000
                    issuer.address,
                    false,
                    utilityNote, // utility note value = original note + public comparison = 2000 + 2020 = 4020
                    true
                )
                expect(
                    publicRangeProof.checkBalancingRelationShipSatisfied()
                ).toBeUndefined()
            })
            test("CB note value >= 1990, proof sent by provider 1", async () => {
                const utilityNote = await note.create(issuer.publicKey, 10)
                const publicRangeProof = new PublicRangeProof(
                    issuerNote1,
                    1990,
                    provider1.address,
                    true,
                    utilityNote,
                    true
                )
                expect(
                    publicRangeProof.checkBalancingRelationShipSatisfied()
                ).toBeUndefined()
            })
            test("Failed from incorrect utility note value", async () => {
                const utilityNote = await note.create(issuer.publicKey, 8)
                try {
                    const publicRangeProof = new PublicRangeProof(
                        issuerNote1,
                        1990,
                        issuer.address,
                        true,
                        utilityNote,
                        false
                    )
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch(
                        "BALANCING_RELATION_NOT_SATISFIED"
                    )
                }
            })
            test("CB note value >= 2000, correct zero utility note value, sent by Issuer", async () => {
                const utilityNote = await note.create(issuer.publicKey, 0)
                const publicRangeProof = new PublicRangeProof(
                    issuerNote1,
                    2000,
                    issuer.address,
                    true,
                    utilityNote,
                    true
                )
                expect(
                    publicRangeProof.checkBalancingRelationShipSatisfied()
                ).toBeUndefined()
            })
        })

        describe("Private range proofs of first Issuer note", () => {
            // See PrivateRangeProof66562 API for parameter details https://aztecprotocol.github.io/AZTEC/PrivateRangeProof66562.html
            test("CB note value >= note with value 1900, sent by Issuer", async () => {
                // note value less the public comparison value. 2000 - 1900 = 100
                const comparisonNote = await note.create(issuer.publicKey, 1900)
                const utilityNote = await note.create(issuer.publicKey, 100)
                const publicRangeProof = new PrivateRangeProof(
                    issuerNote1, // originalNote being compared
                    comparisonNote, // comparisonNote value the note is being compared against
                    utilityNote, // a note with different between the note value and the comparison note value.
                    issuer.address, // sender of the proof
                    true // safeguard flag to turn on a balancing check prior to construction of proof
                )
                expect(
                    publicRangeProof.checkBalancingRelationShipSatisfied()
                ).toBeUndefined()
            })
            test("CB note value >= note with value 1900, sent by provider 1", async () => {
                const comparisonNote = await note.create(
                    provider1.publicKey,
                    1900
                )
                const utilityNote = await note.create(provider1.publicKey, 100)
                const publicRangeProof = new PrivateRangeProof(
                    issuerNote1,
                    comparisonNote,
                    utilityNote,
                    provider1.address,
                    true
                )
                expect(
                    publicRangeProof.checkBalancingRelationShipSatisfied()
                ).toBeUndefined()
            })
            test("CB note value >= note with same value, sent by Issuer", async () => {
                // note value less the public comparison value. 2000 - 2000 = 0
                const comparisonNote = await note.create(issuer.publicKey, 2000)
                const utilityNote = await note.create(issuer.publicKey, 0)
                const publicRangeProof = new PrivateRangeProof(
                    issuerNote1, // originalNote being compared
                    comparisonNote, // comparisonNote value the note is being compared against
                    utilityNote, // a note with different between the note value and the comparison note value.
                    issuer.address, // sender of the proof
                    true // safeguard flag to turn on a balancing check prior to construction of proof
                )
                expect(
                    publicRangeProof.checkBalancingRelationShipSatisfied()
                ).toBeUndefined()
            })
            test("Failed from incorrect utility note value - too big", async () => {
                const comparisonNote = await note.create(issuer.publicKey, 1900)
                const utilityNote = await note.create(issuer.publicKey, 200)
                try {
                    const publicRangeProof = new PrivateRangeProof(
                        issuerNote1,
                        comparisonNote,
                        utilityNote,
                        issuer.address,
                        true
                    )
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch(
                        "BALANCING_RELATION_NOT_SATISFIED"
                    )
                }
            })
            test("Failed from incorrect utility note value - too small", async () => {
                const comparisonNote = await note.create(issuer.publicKey, 1900)
                const utilityNote = await note.create(issuer.publicKey, 20)
                try {
                    const publicRangeProof = new PrivateRangeProof(
                        issuerNote1,
                        comparisonNote,
                        utilityNote,
                        issuer.address,
                        true
                    )
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch(
                        "BALANCING_RELATION_NOT_SATISFIED"
                    )
                }
            })
        })

        let issuerNote3
        let agentNote1
        let provider1Note1
        let provider2Note1
        test("Issuer transfers tokens: 200 provider 1, 600 Provider 2, 300 agent and 900 themselves", async () => {
            issuerZkAsset = zkAsset.connect(issuerSigner)
            issuerNote3 = await note.create(issuer.publicKey, 900)
            provider1Note1 = await note.create(provider1.publicKey, 200)
            expect(provider1Note1.owner).toEqual(provider1.address)
            expect(provider1Note1.k.toNumber()).toEqual(200)

            provider2Note1 = await note.create(provider2.publicKey, 600)
            expect(provider2Note1.owner).toEqual(provider2.address)
            expect(provider2Note1.k.toNumber()).toEqual(600)

            agentNote1 = await note.create(agent.publicKey, 300)
            expect(agentNote1.owner).toEqual(agent.address)
            const sendProof = new JoinSplitProof(
                [issuerNote1], // input notes
                [issuerNote3, provider1Note1, provider2Note1, agentNote1], // output notes
                issuer.address, // tx sender
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner. Only relevant for deposits or withdrawals
            )
            const proofData = sendProof.encodeABI(issuerZkAsset.address)
            const proofSignatures = sendProof.constructSignatures(
                issuerZkAsset.address,
                [issuer]
            )
            const tx = await issuerZkAsset["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })

        let eventNote
        test("provider 1 derives note from CreateNote event and sends ", async () => {
            // get CreateNote event for the note provider 1 owns
            const filter = provider1ZkAsset.filters.CreateNote(
                provider1.address,
                null,
                null
            )
            const events = await provider1ZkAsset.queryFilter(filter)
            expect(events).toHaveLength(2)
            expect(events[0].event).toEqual("CreateNote")
            expect(events[1].event).toEqual("CreateNote")
            const eventArgs = events[1].args
            expect(eventArgs.metadata).toMatch(bytesFixed(97))
            expect(eventArgs.owner).toEqual(provider1.address)
            expect(eventArgs.noteHash).toMatch(bytes32)

            // Derive note from the first CreateNote event
            eventNote = await note.fromEventLog(
                eventArgs.metadata,
                provider1.privateKey
            )
            expect(eventNote.noteHash).toEqual(eventArgs.noteHash)
            expect(eventNote.metaData.slice(2)).toEqual(
                eventArgs.metadata.slice(AZTEC_JS_METADATA_PREFIX_LENGTH)
            )
            expect(eventNote.k.toNumber()).toEqual(200)
            expect(eventNote.owner).toEqual(provider1.address)
            console.log(`Event note ${JSON.stringify(eventNote)}`)
        })

        let provider2Note2
        test("provider 1 sends 30 to Provider 2 and 170 to themselves", async () => {
            provider2Note2 = await note.create(provider2.publicKey, 30)
            const provider1Note2 = await note.create(provider1.publicKey, 170)
            const sendProof = new JoinSplitProof(
                [eventNote],
                [provider1Note2, provider2Note2],
                provider1.address,
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // token owner. Only relevant for deposits or withdrawals
            )
            const proofData = sendProof.encodeABI(provider1ZkAsset.address)
            const proofSignatures = sendProof.constructSignatures(
                provider1ZkAsset.address,
                [provider1]
            )
            const tx = await provider1ZkAsset[
                "confidentialTransfer(bytes,bytes)"
            ](proofData, proofSignatures)
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })

        let provider1Note3
        test("Provider 2 transfer using multiple inputs and outputs", async () => {
            const provider2Note3 = await note.create(provider2.publicKey, 580) // 600 + 30 - 50
            provider1Note3 = await note.create(provider1.publicKey, 50)
            const agentNote0 = await note.create(agent.publicKey, 0)
            // const zeroNote = await note.createZeroValueNote()
            const sendProof = new JoinSplitProof(
                [provider2Note1, provider2Note2], // input notes 600, 30
                [provider2Note3, provider1Note3, agentNote0], // output notes 580, 50, 0
                provider2.address, // sender
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // token owner. Only relevant for deposits or withdrawals
            )
            const proofData = sendProof.encodeABI(provider2ZkAsset.address)
            const proofSignatures = sendProof.constructSignatures(
                provider2ZkAsset.address,
                [provider2, provider2]
            )
            const tx = await provider2ZkAsset[
                "confidentialTransfer(bytes,bytes)"
            ](proofData, proofSignatures)
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })

        let agentClientNote1
        test("Agent sends 100 tokens to their client 1", async () => {
            const abZkAsset = zkAsset.connect(agentSigner)
            const agentNote2 = await note.create(agent.publicKey, 200)
            agentClientNote1 = await note.create(agentClient1.publicKey, 100)
            const sendProof = new JoinSplitProof(
                [agentNote1],
                [agentNote2, agentClientNote1],
                agent.address,
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // token owner. Only relevant for deposits or withdrawals
            )
            const proofData = sendProof.encodeABI(abZkAsset.address)
            const proofSignatures = sendProof.constructSignatures(
                abZkAsset.address,
                [agent]
            )
            const tx = await abZkAsset["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })

        test("Client 1 sends 20 tokens to provider 1 via their agent", async () => {
            const abZkAsset = zkAsset.connect(agentSigner)
            const agentClientNote2 = await note.create(
                agentClient1.publicKey,
                80
            )
            const provider1Note2 = await note.create(provider1.publicKey, 20)
            const sendProof = new JoinSplitProof(
                [agentClientNote1], // input notes
                [agentClientNote2, provider1Note2], // output notes
                agent.address, // tx sender
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // token owner. Only relevant for deposits or withdrawals
            )
            const proofData = sendProof.encodeABI(abZkAsset.address)
            const proofSignatures = sendProof.constructSignatures(
                abZkAsset.address,
                [agentClient1]
            )
            const tx = await abZkAsset["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })

        describe("Burn", () => {
            let issuerNote4
            let issuerBurnNote
            test("Issuer splits 900 value note into 880 and 20 so 20 can be burnt", async () => {
                issuerNote4 = await note.create(issuer.publicKey, 880)
                issuerBurnNote = await note.create(issuer.publicKey, 20)
                const sendProof = new JoinSplitProof(
                    [issuerNote3], // input notes
                    [issuerNote4, issuerBurnNote], // output notes
                    issuer.address, // tx sender
                    0, // deposit (negative), withdrawal (positive) or transfer (zero)
                    zeroAddress // public token owner. Only relevant for deposits or withdrawals
                )
                const proofData = sendProof.encodeABI(issuerZkAsset.address)
                const proofSignatures = sendProof.constructSignatures(
                    issuerZkAsset.address,
                    [issuer]
                )
                const tx = await issuerZkAsset[
                    "confidentialTransfer(bytes,bytes)"
                ](proofData, proofSignatures)
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })

            let firstBurnNewTotalValueNote
            test("Deployer (contract owner) burns Issuer note of value 20", async () => {
                const currentTotalValueNote = await note.createZeroValueNote()
                firstBurnNewTotalValueNote = await note.create(
                    deployer.publicKey,
                    20
                )
                const burnProof = new BurnProof(
                    currentTotalValueNote,
                    firstBurnNewTotalValueNote,
                    [issuerBurnNote],
                    deployer.address
                )

                const burnData = burnProof.encodeABI()

                // Check the burnt note does not exist yet
                let burntNote = await aceContract.getNote(
                    zkAsset.address,
                    issuerBurnNote.noteHash
                )
                expect(burntNote.status).toEqual(1)

                const tx = await zkAsset.confidentialBurn(
                    proofs.BURN_PROOF,
                    burnData
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)

                // Check the burnt note is spent
                burntNote = await aceContract.getNote(
                    zkAsset.address,
                    issuerBurnNote.noteHash
                )
                expect(burntNote.status).toEqual(2)

                const totalMintedNoteHash = registry.confidentialTotalMinted
                expect(totalMintedNoteHash).toMatch(bytes32)
                const totalBurnedNoteHash = registry.confidentialTotalBurned
                expect(totalBurnedNoteHash).toMatch(bytes32)
                // TODO get totalBurnedNote and assert the value
                // const totalBurnedNote = await aceContract.getNote(
                //     zkAsset.address,
                //     totalBurnedNoteHash
                // )
                // expect(currentTotalValueNote.status).toEqual(1)
                // // expect(currentTotalValueNote.k.toNumber()).toEqual(20)

                // These are zero as there is no linked token contract in a direct zkAsset
                expect(registry.totalSupplemented).toEqualBN(0)
                expect(registry.totalSupply).toEqualBN(0)
            })

            test("Deployer (contract owner) burns provider 1 note 3 of value 50", async () => {
                const newTotalValueNote = await note.create(
                    deployer.publicKey,
                    70
                )
                const burnProof = new BurnProof(
                    firstBurnNewTotalValueNote,
                    newTotalValueNote,
                    [provider1Note3],
                    deployer.address
                )

                const burnData = burnProof.encodeABI()

                const tx = await zkAsset.confidentialBurn(
                    proofs.BURN_PROOF,
                    burnData
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })
        })
    })

    describe("Direct ZkAsset with scaling", () => {
        let issuerMigrator: Migrator
        let newTotalValueNote: number
        let issuerZkAsset: ZkAssetDirect
        let provider1ZkAsset: ZkAssetDirect
        let provider2ZkAsset: ZkAssetDirect
        let registry

        beforeAll(async () => {
            issuerMigrator = await migratorFactory(issuerSigner)
        })

        test("Deploy a zero-knowledge direct scaled asset", async () => {
            const scalingFactor = 1000
            issuerZkAsset = await ZkAssetDirectMigrator(
                issuerMigrator,
                aceContract.address,
                scalingFactor
            )
            expect(issuerZkAsset.address).toMatch(ethereumAddress)
            issuerZkAsset = issuerZkAsset.connect(issuerSigner)
            provider1ZkAsset = issuerZkAsset.connect(provider1Signer)
            provider2ZkAsset = issuerZkAsset.connect(provider2Signer)

            registry = await aceContract.getRegistry(issuerZkAsset.address)
            expect(registry.scalingFactor).toEqualBN(scalingFactor)
        })

        describe("Mint", () => {
            let issuerNote1Receipt
            test("Issuer mints notes with total value < 10 mil", async () => {
                const currentTotalValueNote = await note.createZeroValueNote()
                newTotalValueNote = await note.create(issuer.publicKey, 9999999)
                const issuerNote1 = await note.create(issuer.publicKey, 4999999)
                const provider1Note1 = await note.create(
                    issuer.publicKey,
                    5000000
                )
                const mintProof = new MintProof(
                    currentTotalValueNote, // previous sum of all notes
                    newTotalValueNote, // new sum of all notes
                    [issuerNote1, provider1Note1], // new minted notes
                    issuer.address // sender
                )
                const mintData = mintProof.encodeABI()
                const tx = await issuerZkAsset.confidentialMint(
                    proofs.MINT_PROOF,
                    mintData
                )
                expect(tx.hash).toMatch(transactionHash)
                issuerNote1Receipt = await tx.wait()
                expect(issuerNote1Receipt.status).toEqual(1)
            })

            test("Issuer can not mint >= ten mil total value", async () => {
                expect.assertions(2)
                const currentTotalValueNote = newTotalValueNote
                newTotalValueNote = await note.create(
                    issuer.publicKey,
                    10000000
                )
                const issuerNote2 = await note.create(issuer.publicKey, 1)
                try {
                    const mintProof = new MintProof(
                        currentTotalValueNote, // previous sum of all notes
                        newTotalValueNote, // new sum of all notes
                        [issuerNote2], // new minted notes
                        issuer.address // sender
                    )
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch("NOTE_VALUE_TOO_BIG")
                }
            })
        })
    })

    describe.skip("Swap two zero-knowledge assets", () => {
        let provider1Ace
        let provider2Ace
        let assetA: ZkAssetDirect
        let assetB: ZkAssetDirect
        let provider1AssetA: ZkAssetDirect
        let provider1AssetB: ZkAssetDirect
        let provider2AssetA: ZkAssetDirect
        let provider2AssetB: ZkAssetDirect
        let provider1AssetANote1
        let provider1AssetBNote1
        let provider2AssetANote1
        let provider2AssetBNote1

        describe("Test setup", () => {
            test("Connect Provider 1 and 2 to ACE contract", async () => {
                provider1Ace = aceContract.connect(provider1Signer)
                provider2Ace = aceContract.connect(provider2Signer)

                const swapContract = await aceContract.getValidatorAddress(
                    proofs.SWAP_PROOF
                )
                expect(swapContract).toMatch(ethereumAddress)
                expect(
                    await provider2Ace.getValidatorAddress(proofs.SWAP_PROOF)
                ).toEqual(swapContract)
            })
            test("Deploy adjustable zero-knowledge assets A and B", async () => {
                assetA = await ZkAssetDirectMigrator(
                    migrator,
                    aceContract.address
                )
                assetB = await ZkAssetDirectMigrator(
                    migrator,
                    aceContract.address
                )
                provider1AssetA = assetA.connect(provider1Signer)
                provider1AssetB = assetB.connect(provider1Signer)
                provider2AssetA = assetA.connect(provider2Signer)
                provider2AssetB = assetB.connect(provider2Signer)
                expect(
                    await assetA.supportsProof(proofs.SWAP_PROOF)
                ).toBeTruthy()
            })

            test("Mint 100 A assets to Provider 1", async () => {
                provider1AssetANote1 = await note.create(
                    provider1.publicKey,
                    100
                )
                const zeroValueNote = await note.createZeroValueNote()
                const newTotalValueAssetANote1 = await note.create(
                    deployer.publicKey,
                    100
                )
                const mintProof = new MintProof(
                    zeroValueNote,
                    newTotalValueAssetANote1,
                    [provider1AssetANote1],
                    deployer.address
                )
                const mintData = mintProof.encodeABI()
                const tx = await assetA.confidentialMint(
                    proofs.MINT_PROOF,
                    mintData
                )
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)

                const registryProvider1AssetANote1 = await aceContract.getNote(
                    assetA.address,
                    provider1AssetANote1.noteHash
                )
                expect(registryProvider1AssetANote1.status).toEqual(1) // UNSPENT
                expect(registryProvider1AssetANote1.noteOwner).toEqual(
                    provider1.address
                )
            })
            test("Mint 110 B assets to provider 2", async () => {
                provider2AssetBNote1 = await note.create(
                    provider2.publicKey,
                    110
                )
                const zeroValueNote = await note.createZeroValueNote()
                const newTotalValueAssetBNote1 = await note.create(
                    deployer.publicKey,
                    110
                )
                const mintProof = new MintProof(
                    zeroValueNote,
                    newTotalValueAssetBNote1,
                    [provider2AssetBNote1],
                    deployer.address
                )
                const mintData = mintProof.encodeABI()
                const tx = await assetB.confidentialMint(
                    proofs.MINT_PROOF,
                    mintData
                )
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)

                const registryProvider2AssetBNote1 = await aceContract.getNote(
                    assetB.address,
                    provider2AssetBNote1.noteHash
                )
                expect(registryProvider2AssetBNote1.status).toEqual(1) // UNSPENT
                expect(registryProvider2AssetBNote1.noteOwner).toEqual(
                    provider2.address
                )
            })
        })
        let swapProof
        test("Construct Swap Proof for Provider 1 swaps 100 A assets with Provider 2's 110 B assets", async () => {
            provider2AssetANote1 = await note.create(provider2.publicKey, 100)
            provider1AssetBNote1 = await note.create(provider1.publicKey, 110)
            swapProof = new SwapProof(
                [provider1AssetANote1, provider2AssetBNote1], // 100, 110
                [provider2AssetANote1, provider1AssetBNote1], // 100, 110
                provider1.address
            )
            expect(proofs.SWAP_PROOF).toEqual("65794")
        })
        test("Provider 1 validates swap proof", async () => {
            const tx = await provider1Ace.validateProof(
                proofs.SWAP_PROOF,
                provider1.address,
                swapProof.encodeABI()
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            // expect(receipt.events).toHaveLength(2)
            // expect(receipt.events[0].args.proofHash).toEqual(swapProof.hash)
            // expect(
            //   await provider1Ace.validateProofByHash(
            //     proofs.SWAP_PROOF,
            //     swapProof.validatedProofHash,
            //     provider1.address
            //   )
            // ).toBeTruthy()
        })
        // test("Provider 2 validates swap proof", async () => {
        //     const tx = await provider2Ace.validateProof(
        //         proofs.SWAP_PROOF,
        //         provider2.address,
        //         swapProof.encodeABI()
        //     )
        //     expect(tx.hash).toMatch(transactionHash)
        //     const receipt = await tx.wait()
        //     expect(receipt.status).toEqual(1)
        //     expect(receipt.events).toHaveLength(2)
        //     expect(receipt.events[0].args.proofHash).toEqual(swapProof.hash)
        //     expect(
        //         await provider2Ace.validateProofByHash(
        //             proofs.SWAP_PROOF,
        //             swapProof.validatedProofHash,
        //             provider2.address
        //         )
        //     ).toBeTruthy()
        // })
        test("Provider 1 transfers 110 Asset B from Provider 2", async () => {
            expect(proofs.SWAP_PROOF).toEqual("65794")
            const tx = await provider1AssetB[
                "confidentialTransferFrom(uint24,bytes)"
            ](proofs.SWAP_PROOF, swapProof.eth.outputs)
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })

        test("Provider 1, asset A note is spent", async () => {
            const registryProvider1AssetANote1 = await aceContract.getNote(
                assetA.address,
                provider1AssetANote1.noteHash
            )
            expect(registryProvider1AssetANote1.status).toEqual(2) // SPENT
        })

        test("Provider 2 transfers 100 Asset A from Provider 1", async () => {
            expect(proofs.SWAP_PROOF).toEqual("65794")
            const tx = await provider2AssetA[
                "confidentialTransferFrom(uint24,bytes)"
            ](proofs.SWAP_PROOF, swapProof.eth.outputs)
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })
        test("Provider 2, asset B note is spent", async () => {
            const registryProvider2AssetBNote1 = await aceContract.getNote(
                assetB.address,
                provider2AssetBNote1.noteHash
            )
            expect(registryProvider2AssetBNote1.status).toEqual(2) // SPENT
        })
    })
})
