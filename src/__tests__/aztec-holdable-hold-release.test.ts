import { proofs } from "@aztec/dev-utils"
import secp256k1 from "@aztec/secp256k1"
import { JoinSplitProof, MintProof, note } from "aztec.js"
import { Signer } from "ethers"
import { keccak256 } from "ethers/lib/utils"
import { compilerOutput as dvpHoldableLockableSwapCompilerOutput } from "../chain/contracts/DVPHoldableLockableSwapContract"
import { compilerOutput as holdableTokenCompilerOutput } from "../chain/contracts/HoldableTokenContract"
import { compilerOutput as zkAssetHoldableCompilerOutput } from "../chain/contracts/ZkAssetHoldableContract"
import AceMigator from "../chain/migration/1_ace"
import migratorFactory, { Migrator } from "../chain/migration/migrator"
import {
    ACE,
    DVPHoldableLockableSwap,
    HoldableToken,
    ZkAssetHoldable,
} from "../chain/types"
import { zeroAddress } from "../chain/utils/addresses"
import { aztecSigner } from "../chain/utils/aztecSigner"
import { WalletSigner } from "../chain/wallet/WalletSigner"
import configPromise from "../config/index"
import { newSecretHashPair } from "../utils/crypto"
import { EthersMatchers } from "../utils/jest"
import { bytes32, ethereumAddress, transactionHash } from "../utils/regEx"
import { addDays, epochSeconds } from "../utils/time"

jest.setTimeout(60000) // timeout for each test in milliseconds
// Extend the Jest matchers with Ethers BigNumber matchers like toEqualBN
expect.extend(EthersMatchers)

const deployer = secp256k1.generateAccount()
const centralBank = secp256k1.generateAccount()
const seller = secp256k1.generateAccount()
const buyer = secp256k1.generateAccount()
const notary = secp256k1.generateAccount()

describe("Holdable, Hash-Lock, Zero-Knowledge Asset Swap", () => {
    let aceContract: ACE
    let cbAce: ACE
    let notaryAce: ACE
    let migrator: Migrator
    let centralBankMigrator: Migrator
    let centralBankSigner: Signer
    let sellerSigner: Signer
    let buyerSigner: Signer
    let notarySigner: Signer
    let asset: HoldableToken
    let sellerAsset: HoldableToken
    let buyerAsset: HoldableToken
    let cbCBDC: ZkAssetHoldable
    let sellerCBDC: ZkAssetHoldable
    let buyerCBDC: ZkAssetHoldable
    let notaryCBDC: ZkAssetHoldable
    let swapContract: DVPHoldableLockableSwap
    let test1BuyerCBDCNote1
    let test2BuyerCBDCNote1

    beforeAll(async () => {
        const config = await configPromise
        if (!config?.chain?.wallet) {
            throw Error(`Failed to load config for chain.wallet.`)
        }
        const deployerWallet = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: deployer.privateKey,
        })

        centralBankSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: centralBank.privateKey,
        })
        sellerSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: seller.privateKey,
        })
        buyerSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: buyer.privateKey,
        })
        notarySigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: notary.privateKey,
        })

        migrator = await migratorFactory(deployerWallet)
        centralBankMigrator = await migratorFactory(centralBankSigner)
    })

    describe("Test setup", () => {
        test("Deploy a holdable token asset", async () => {
            asset = await migrator.deploy<HoldableToken>(
                holdableTokenCompilerOutput,
                "Test Asset", // name
                "TST", // symbol
                0 // decimals
            )
            sellerAsset = asset.connect(sellerSigner)
            buyerAsset = asset.connect(buyerSigner)
        })
        test("Mint some asset to the seller", async () => {
            const tx = await asset.mint(seller.address, 100)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })
        test("Deploy proof contracts and ACE", async () => {
            aceContract = await AceMigator(migrator)
            expect(aceContract.address).toMatch(ethereumAddress)
            expect(await aceContract.latestEpoch()).toEqual(1)
            expect(
                await aceContract.getValidatorAddress(proofs.JOIN_SPLIT_PROOF)
            ).toMatch(ethereumAddress)
            cbAce = aceContract.connect(centralBankSigner)
            notaryAce = aceContract.connect(notarySigner)
        })

        test("Deploy zero-knowledge CBDC", async () => {
            cbCBDC = await centralBankMigrator.deploy<ZkAssetHoldable>(
                zkAssetHoldableCompilerOutput,
                aceContract.address,
                1
            )
            sellerCBDC = cbCBDC.connect(sellerSigner)
            buyerCBDC = cbCBDC.connect(buyerSigner)
            notaryCBDC = cbCBDC.connect(notarySigner)
        })

        test("Central Bank mints CBDC notes to the buyer", async () => {
            test1BuyerCBDCNote1 = await note.create(buyer.publicKey, 1000)
            test2BuyerCBDCNote1 = await note.create(buyer.publicKey, 1000)

            const zeroValueNote = await note.createZeroValueNote()
            const newTotalValueAssetNote1 = await note.create(
                deployer.publicKey,
                2000
            )
            const mintProof = new MintProof(
                zeroValueNote,
                newTotalValueAssetNote1,
                [test1BuyerCBDCNote1, test2BuyerCBDCNote1],
                centralBank.address
            )
            const mintData = mintProof.encodeABI()
            const tx = await cbCBDC.confidentialMint(
                proofs.MINT_PROOF,
                mintData
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })

        test("Deploy Holdable Swap Contract", async () => {
            swapContract = await migrator.deploy<DVPHoldableLockableSwap>(
                dvpHoldableLockableSwapCompilerOutput
            )
        })
    })
    describe("Buyer holds CBDC for the Seller using a notary", () => {
        const hashLock = newSecretHashPair()
        let test1BuyerCBDCNote2
        let test1BuyerCBDCNote3
        let test1BuyerCBDCNote4
        let test1BuyerCBDCNote5
        let test1BuyerCBDCNote6
        let splitProofData
        let holdProof
        let splitProofSignatures
        let sellerCBDCNote1
        let sellerCBDCNote2
        let sellerCBDCNote3
        let sellerCBDCNote4
        let sellerCBDCNote5

        let holdId: string
        test("Constructs first proof to split buyer's 1000 note into 5 lots of 200", async () => {
            test1BuyerCBDCNote2 = await note.create(buyer.publicKey, 200)
            test1BuyerCBDCNote3 = await note.create(buyer.publicKey, 200)
            test1BuyerCBDCNote4 = await note.create(buyer.publicKey, 200)
            test1BuyerCBDCNote5 = await note.create(buyer.publicKey, 200)
            test1BuyerCBDCNote6 = await note.create(buyer.publicKey, 200)

            const splitProof = new JoinSplitProof(
                [test1BuyerCBDCNote1], // input note 1000
                [
                    test1BuyerCBDCNote2,
                    test1BuyerCBDCNote3,
                    test1BuyerCBDCNote4,
                    test1BuyerCBDCNote5,
                    test1BuyerCBDCNote6,
                ], // output notes 200 each
                buyer.address,
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
            splitProofData = splitProof.encodeABI(buyerCBDC.address)
            splitProofSignatures = splitProof.constructSignatures(
                buyerCBDC.address,
                [buyer]
            )
        })
        test("Constructs second proof to send buyer's 5 200 notes to the seller using the notary in 2 notes", async () => {
            // Only seems to work with even inputs and outputs
            // This test should be rewritten with one input to multiple outputs once this bug is fixed
            sellerCBDCNote1 = await note.create(seller.publicKey, 200)
            sellerCBDCNote2 = await note.create(seller.publicKey, 200)
            sellerCBDCNote3 = await note.create(seller.publicKey, 200)
            sellerCBDCNote4 = await note.create(seller.publicKey, 200)
            sellerCBDCNote5 = await note.create(seller.publicKey, 200)

            holdProof = new JoinSplitProof(
                [
                    test1BuyerCBDCNote2,
                    test1BuyerCBDCNote3,
                    test1BuyerCBDCNote4,
                    test1BuyerCBDCNote5,
                    test1BuyerCBDCNote6,
                ], // input notes 200 each * 5 = 1000
                [
                    sellerCBDCNote1,
                    sellerCBDCNote2,
                    sellerCBDCNote3,
                    sellerCBDCNote4,
                    sellerCBDCNote5,
                ], // output note 5 * 200
                buyerCBDC.address,
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
        })
        test("Buyer holds notes for the seller using a notary", async () => {
            const expiration = new Date()
            const holdSignature = aztecSigner.signHoldForProof(
                buyerCBDC.address,
                holdProof.eth.output,
                notary.address,
                epochSeconds(expiration),
                hashLock.hash,
                buyer.privateKey
            )
            const holdProofData = holdProof.encodeABI(buyerCBDC.address)
            const tx = await buyerCBDC.splitAndHoldProofs(
                proofs.JOIN_SPLIT_PROOF,
                splitProofData,
                holdProofData,
                notary.address,
                epochSeconds(expiration),
                hashLock.hash,
                splitProofSignatures,
                holdSignature
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events[6].event).toEqual("NewHold")
            expect(receipt.events[6].args.sender).toEqual(buyer.address)
            expect(receipt.events[6].args.lockHash).toEqual(hashLock.hash)
            expect(receipt.events[6].args.notary).toEqual(notary.address)
            expect(receipt.events[6].args.inputNoteHashes).toHaveLength(5)
            expect(receipt.events[6].args.outputNoteHashes).toHaveLength(5)
            expect(receipt.events[6].args.holdId).toMatch(bytes32)
            holdId = receipt.events[6].args.holdId
        })

        test("Buyer can not spend note('s) on hold", async () => {
            const testCBDCNote = await note.create(seller.publicKey, 200)
            expect.assertions(2)
            const proof = new JoinSplitProof(
                [test1BuyerCBDCNote2], // input notes 200
                [testCBDCNote], // output notes 200
                buyer.address, // the confidentialTransferFrom comes from the ZkAsset
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
            const proofData = proof.encodeABI(buyerCBDC.address)
            const proofSignatures = proof.constructSignatures(
                buyerCBDC.address,
                [buyer]
            )
            const tx = await buyerCBDC["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            try {
                await tx.wait()
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch(
                    "confidentialTransfer: input note is on hold"
                )
            }
        })
        test("Validate on-chain note statuses", async () => {
            expect.assertions(4)
            expect(
                (
                    await aceContract.getNote(
                        buyerCBDC.address,
                        test1BuyerCBDCNote1.noteHash
                    )
                ).status
            ).toEqual(2) // SPENT
            expect(
                (
                    await aceContract.getNote(
                        buyerCBDC.address,
                        test1BuyerCBDCNote2.noteHash
                    )
                ).status
            ).toEqual(1) // UNSPENT
            try {
                await aceContract.getNote(
                    buyerCBDC.address,
                    sellerCBDCNote1.noteHash
                )
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch("expected note to exist")
            }
        })
        test("Buyer releases hold", async () => {
            const releaseSignature = aztecSigner.signReleaseForProofHold(
                buyerCBDC.address,
                holdId,
                buyer.privateKey
            )
            const tx = await buyerCBDC.releaseHold(holdId, releaseSignature)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(
                (
                    await aceContract.getNote(
                        buyerCBDC.address,
                        test1BuyerCBDCNote2.noteHash
                    )
                ).status
            ).toEqual(1) // UNSPENT
        })
        test("Buyer spends note that was previously held", async () => {
            const testCBDCNote = await note.create(seller.publicKey, 200)
            const proof = new JoinSplitProof(
                [test1BuyerCBDCNote2], // input notes 200
                [testCBDCNote], // output notes 200
                buyer.address, // the confidentialTransferFrom comes from the ZkAsset
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
            const proofData = proof.encodeABI(buyerCBDC.address)
            const proofSignatures = proof.constructSignatures(
                buyerCBDC.address,
                [buyer]
            )
            const tx = await buyerCBDC["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(
                (
                    await aceContract.getNote(
                        buyerCBDC.address,
                        test1BuyerCBDCNote2.noteHash
                    )
                ).status
            ).toEqual(2) // SPENT
        })
    })
    describe("CBDC hold", () => {
        const hashLock = newSecretHashPair()
        let joinSplitProof
        let cbdcHoldId: string
        const testCBDCNotes = []
        const sellerCBDCNotes = []
        test("Splits note into multiple", async () => {
            for (let i = 0; i < 5; i++) {
                testCBDCNotes.push(await note.create(buyer.publicKey, 200))
            }

            expect.assertions(3)
            const proof = new JoinSplitProof(
                [test2BuyerCBDCNote1], // input notes 1000
                testCBDCNotes, // output notes 5*200
                buyer.address, // the confidentialTransferFrom comes from the ZkAsset
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
            const proofData = proof.encodeABI(buyerCBDC.address)
            const proofSignatures = proof.constructSignatures(
                buyerCBDC.address,
                [buyer]
            )
            const tx = await buyerCBDC["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(6)
            expect(receipt.events[5].event).toEqual("CreateNote")
        })
        test("Constructs JoinSplit proof to send 1000 CBDC from buyer to seller via the swap contract", async () => {
            // Uses multiple notes as input/output must match
            for (let i = 0; i < 5; i++) {
                sellerCBDCNotes.push(await note.create(seller.publicKey, 200))
            }
            joinSplitProof = new JoinSplitProof(
                testCBDCNotes, // input notes 5 * 200
                sellerCBDCNotes, // output notes 5 * 200
                buyerCBDC.address, // has to be the zk asset
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
        })
        test("Buyer holds 100 CBDC tokens for the seller using the swap contract", async () => {
            const expiration = new Date()
            const holdSignature = aztecSigner.signHoldForProof(
                buyerCBDC.address,
                joinSplitProof.eth.output,
                swapContract.address, // the notary allowed to execute the hold
                epochSeconds(expiration),
                hashLock.hash,
                buyer.privateKey
            )
            const proofData = joinSplitProof.encodeABI(buyerCBDC.address)
            const tx = await buyerCBDC.holdProof(
                proofs.JOIN_SPLIT_PROOF,
                proofData,
                swapContract.address,
                epochSeconds(expiration),
                hashLock.hash,
                holdSignature
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(1)
            expect(receipt.events[0].event).toEqual("NewHold")
            expect(receipt.events[0].args.sender).toEqual(buyer.address)
            expect(receipt.events[0].args.lockHash).toEqual(hashLock.hash)
            expect(receipt.events[0].args.notary).toEqual(swapContract.address)
            expect(receipt.events[0].args.inputNoteHashes).toHaveLength(5)
            expect(receipt.events[0].args.outputNoteHashes).toHaveLength(5)
            expect(receipt.events[0].args.holdId).toMatch(bytes32)
            cbdcHoldId = receipt.events[0].args.holdId
        })
        test("Get hold status", async () => {
            expect(await buyerCBDC.holdStatus(cbdcHoldId)).toEqual(1)
        })
        test("Check proof is approval", async () => {
            expect(
                await buyerCBDC.confidentialApproved(
                    keccak256(joinSplitProof.eth.output),
                    buyerCBDC.address
                )
            ).toBeTruthy()
        })
        test("Buyer can not spend note on hold", async () => {
            expect.assertions(2)
            const proof = new JoinSplitProof(
                testCBDCNotes, // input notes 5*200
                sellerCBDCNotes, // output notes 5*200
                buyer.address, // the confidentialTransferFrom comes from the ZkAsset
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
            const proofData = proof.encodeABI(buyerCBDC.address)
            const proofSignatures = proof.constructSignatures(
                buyerCBDC.address,
                [buyer, buyer, buyer, buyer, buyer]
            )
            const tx = await buyerCBDC["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            try {
                await tx.wait()
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch(
                    "confidentialTransfer: input note is on hold"
                )
            }
        })
        test("Buyer releases hold", async () => {
            const releaseSignature = aztecSigner.signReleaseForProofHold(
                buyerCBDC.address,
                cbdcHoldId,
                buyer.privateKey
            )
            const tx = await buyerCBDC.releaseHold(cbdcHoldId, releaseSignature)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(await buyerCBDC.holdStatus(cbdcHoldId)).toEqual(3) // 3 = released
        })
        test("Buyer attempts to use the previously held notes", async () => {
            const proof = new JoinSplitProof(
                testCBDCNotes, // input notes 100
                sellerCBDCNotes, // output notes 100
                buyer.address, // the confidentialTransferFrom comes from the ZkAsset
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
            const proofData = proof.encodeABI(buyerCBDC.address)
            const proofSignatures = proof.constructSignatures(
                buyerCBDC.address,
                [buyer, buyer, buyer, buyer, buyer]
            )
            const tx = await buyerCBDC["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(10)
            expect(receipt.events[0].event).toEqual("DestroyNote")
            expect(receipt.events[1].event).toEqual("DestroyNote")
            expect(receipt.events[2].event).toEqual("DestroyNote")
            expect(receipt.events[3].event).toEqual("DestroyNote")
            expect(receipt.events[4].event).toEqual("DestroyNote")
            expect(receipt.events[5].event).toEqual("CreateNote")
            expect(receipt.events[6].event).toEqual("CreateNote")
            expect(receipt.events[7].event).toEqual("CreateNote")
            expect(receipt.events[8].event).toEqual("CreateNote")
            expect(receipt.events[9].event).toEqual("CreateNote")
        })
    })
})
