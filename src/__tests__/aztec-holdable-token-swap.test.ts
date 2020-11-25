import { proofs } from "@aztec/dev-utils"
import secp256k1 from "@aztec/secp256k1"
import { JoinSplitProof, MintProof, note } from "aztec.js"
import { Signer } from "ethers"
import { keccak256 } from "ethers/lib/utils"
import {
    compilerOutput as dvpCompilerOutput,
    Standard,
} from "../chain/contracts/DVPHoldableLockableSwapContract"
import { compilerOutput as holdableTokenCompilerOutput } from "../chain/contracts/HoldableTokenContract"
import { compilerOutput as zkAssetHoldableCompilerOutput } from "../chain/contracts/ZkAssetHoldableContract"
import AceMigator from "../chain/migration/1_ace"
import migratorFactory, { Migrator } from "../chain/migration/migrator"
import { ACE, DVPHoldableLockableSwap, HoldableToken, ZkAssetHoldable } from "../chain/types"
import { zeroAddress } from "../chain/utils/addresses"
import { aztecSigner } from "../chain/utils/aztecSigner"
import { WalletSigner } from "../chain/wallet/WalletSigner"
import configPromise from "../config/index"
import { newSecretHashPair } from "../utils/crypto"
import { EthersMatchers } from "../utils/jest"
import { bytes32, ethereumAddress } from "../utils/regEx"
import { addDays, epochSeconds } from "../utils/time"

jest.setTimeout(60000) // timeout for each test in milliseconds
// Extend the Jest matchers with Ethers BigNumber matchers like toEqualBN
expect.extend(EthersMatchers)

const deployer = secp256k1.generateAccount()
const issuer = secp256k1.generateAccount()
const seller = secp256k1.generateAccount()
const buyer = secp256k1.generateAccount()
const notary = secp256k1.generateAccount()

describe("Holdable, Hash-Lock, Zero-Knowledge Asset Swap", () => {
    let aceContract: ACE
    let cbAce: ACE
    let notaryAce: ACE
    let migrator: Migrator
    let issuerMigrator: Migrator
    let issuerSigner: Signer
    let sellerSigner: Signer
    let buyerSigner: Signer
    let notarySigner: Signer
    let asset: HoldableToken
    let sellerAsset: HoldableToken
    let buyerAsset: HoldableToken
    let issuerCash: ZkAssetHoldable
    let sellerCash: ZkAssetHoldable
    let buyerCash: ZkAssetHoldable
    let notaryCash: ZkAssetHoldable
    let dvpContract: DVPHoldableLockableSwap
    let buyerCashNote1
    let buyerCashNote2

    beforeAll(async () => {
        const config = await configPromise
        if (!config?.chain?.wallet) {
            throw Error(`Failed to load config for chain.wallet.`)
        }
        const deployerWallet = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: deployer.privateKey,
        })

        issuerSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: issuer.privateKey,
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
        issuerMigrator = await migratorFactory(issuerSigner)
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
            cbAce = aceContract.connect(issuerSigner)
            notaryAce = aceContract.connect(notarySigner)
        })

        test("Deploy zero-knowledge Cash", async () => {
            issuerCash = await issuerMigrator.deploy<ZkAssetHoldable>(
                zkAssetHoldableCompilerOutput,
                aceContract.address,
                1
            )
            sellerCash = issuerCash.connect(sellerSigner)
            buyerCash = issuerCash.connect(buyerSigner)
            notaryCash = issuerCash.connect(notarySigner)
        })

        test("Issuer mints cash notes to the buyer", async () => {
            buyerCashNote1 = await note.create(buyer.publicKey, 100)
            buyerCashNote2 = await note.create(buyer.publicKey, 110)
            const zeroValueNote = await note.createZeroValueNote()
            const newTotalValueAssetNote1 = await note.create(
                deployer.publicKey,
                210
            )
            const mintProof = new MintProof(
                zeroValueNote,
                newTotalValueAssetNote1,
                [buyerCashNote1, buyerCashNote2],
                issuer.address
            )
            const mintData = mintProof.encodeABI()
            const tx = await issuerCash.confidentialMint(
                proofs.MINT_PROOF,
                mintData
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })

        test("Deploy Holdable DvP Contract", async () => {
            dvpContract = await migrator.deploy<DVPHoldableLockableSwap>(
                dvpCompilerOutput
            )
        })
    })

    describe("Seller swaps 20 asset token for 100 cash from the buyer", () => {
        const hashLock = newSecretHashPair()
        let joinSplitProof
        let assetHoldId: string
        let cashHoldId: string
        let sellerCashNote1
        describe("Asset hold", () => {
            test("Seller holds 20 asset tokens for the buyer using the swap contract", async () => {
                const expiration = addDays(new Date(), 3)
                const tx = await sellerAsset.hold(
                    buyer.address,
                    dvpContract.address,
                    20,
                    epochSeconds(expiration),
                    hashLock.hash
                )
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                assetHoldId = receipt.events[0].args.holdId
            })
            test("Get asset hold status", async () => {
                expect(await sellerAsset.holdStatus(assetHoldId)).toEqual(1)
            })
            describe("Failure tests for holdable token", () => {
                test("seller release before expiration", async () => {
                    expect.assertions(2)
                    try {
                        const tx = await sellerAsset.releaseHold(assetHoldId)
                        await tx.wait()
                    } catch (err) {
                        expect(err).toBeInstanceOf(Error)
                        expect(err.message).toMatch(
                            "releaseHold: can only release after the expiration date"
                        )
                    }
                })
                test("buyer execute hold instead of swap contract", async () => {
                    expect.assertions(2)
                    try {
                        const tx = await buyerAsset[
                            "executeHold(bytes32,bytes32)"
                        ](assetHoldId, hashLock.secret)
                        await tx.wait()
                    } catch (err) {
                        expect(err).toBeInstanceOf(Error)
                        expect(err.message).toMatch(
                            "executeHold: caller must be the hold notary"
                        )
                    }
                })
            })
        })
        describe("Cash hold", () => {
            test("Constructs JoinSplit proof to send 100 cash from buyer to seller via the swap contract", async () => {
                sellerCashNote1 = await note.create(seller.publicKey, 100)
                joinSplitProof = new JoinSplitProof(
                    [buyerCashNote1], // input notes 100
                    [sellerCashNote1], // output notes 100
                    buyerCash.address, // has to be the zk asset
                    0, // deposit (negative), withdrawal (positive) or transfer (zero)
                    zeroAddress // public token owner
                )
            })
            test("Buyer holds 100 cash tokens for the seller using the swap contract", async () => {
                const expiration = addDays(new Date(), 1)
                const holdSignature = aztecSigner.signHoldForProof(
                    buyerCash.address,
                    joinSplitProof.eth.output,
                    dvpContract.address, // the notary allowed to execute the hold
                    epochSeconds(expiration),
                    hashLock.hash,
                    buyer.privateKey
                )
                const proofData = joinSplitProof.encodeABI(buyerCash.address)
                const tx = await buyerCash.holdProof(
                    proofs.JOIN_SPLIT_PROOF,
                    proofData,
                    dvpContract.address,
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
                expect(receipt.events[0].args.notary).toEqual(
                    dvpContract.address
                )
                expect(receipt.events[0].args.inputNoteHashes).toHaveLength(1)
                expect(receipt.events[0].args.outputNoteHashes).toHaveLength(1)
                expect(receipt.events[0].args.holdId).toMatch(bytes32)
                cashHoldId = receipt.events[0].args.holdId
            })
            test("Get hold status", async () => {
                expect(await buyerCash.holdStatus(cashHoldId)).toEqual(1)
            })
            test("Check proof is approval", async () => {
                expect(
                    await buyerCash.confidentialApproved(
                        keccak256(joinSplitProof.eth.output),
                        buyerCash.address
                    )
                ).toBeTruthy()
            })
            describe("Failure tests for holdable token", () => {
                test("Buyer can not spend note on hold", async () => {
                    expect.assertions(2)
                    const proof = new JoinSplitProof(
                        [buyerCashNote1], // input notes 100
                        [sellerCashNote1], // output notes 100
                        buyer.address, // the confidentialTransferFrom comes from the ZkAsset
                        0, // deposit (negative), withdrawal (positive) or transfer (zero)
                        zeroAddress // public token owner
                    )
                    const proofData = proof.encodeABI(buyerCash.address)
                    const proofSignatures = proof.constructSignatures(
                        buyerCash.address,
                        [buyer]
                    )
                    const tx = await buyerCash[
                        "confidentialTransfer(bytes,bytes)"
                    ](proofData, proofSignatures)
                    try {
                        await tx.wait()
                    } catch (err) {
                        expect(err).toBeInstanceOf(Error)
                        expect(err.message).toMatch(
                            "confidentialTransfer: input note is on hold"
                        )
                    }
                })
                test("Buyer can not release hold before expiration", async () => {
                    expect.assertions(2)
                    const releaseSignature = aztecSigner.signReleaseForProofHold(
                        buyerCash.address,
                        cashHoldId,
                        buyer.privateKey
                    )
                    const tx = await buyerCash.releaseHold(
                        cashHoldId,
                        releaseSignature
                    )
                    try {
                        await tx.wait()
                    } catch (err) {
                        expect(err).toBeInstanceOf(Error)
                        expect(err.message).toMatch(
                            "releaseHold: can only release after the expiration date"
                        )
                    }
                })
            })
        })
        describe("Execute swap", () => {
            test("Seller executes the swap", async () => {
                const tx = await dvpContract[
                    "executeHolds(address,bytes32,uint8,address,bytes32,uint8,bytes32)"
                ](
                    sellerAsset.address,
                    assetHoldId,
                    Standard.HoldableERC20,
                    buyerCash.address,
                    cashHoldId,
                    Standard.HoldableERC20,
                    hashLock.secret
                )
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(receipt.events).toHaveLength(6)
            })
            test("Check asset balances", async () => {
                expect(await buyerAsset.balanceOf(buyer.address)).toEqualBN(20)
                expect(await sellerAsset.balanceOf(seller.address)).toEqualBN(
                    80
                )
            })
            test("Check cash input note was spent", async () => {
                const onChainNote = await aceContract.getNote(
                    issuerCash.address,
                    buyerCashNote1.noteHash
                )
                expect(onChainNote.status).toEqual(2) // SPENT
                expect(onChainNote.noteOwner).toEqual(buyer.address)
            })
            test("Check cash output note is unspent", async () => {
                const onChainNote = await aceContract.getNote(
                    issuerCash.address,
                    sellerCashNote1.noteHash
                )
                expect(onChainNote.status).toEqual(1) // UNSPENT
                expect(onChainNote.noteOwner).toEqual(seller.address)
            })
        })
    })
    describe("Buyer holds 30 cash for the Seller using a notary", () => {
        const hashLock = newSecretHashPair()
        let buyerCashNote3
        let buyerCashNote4
        let splitProofData
        let holdProof
        let splitProofSignatures
        let sellerCashNote2
        let holdId: string
        test("Constructs first proof to split buyer's 100 note into 70 and 30", async () => {
            buyerCashNote3 = await note.create(buyer.publicKey, 30)
            buyerCashNote4 = await note.create(buyer.publicKey, 80)
            const splitProof = new JoinSplitProof(
                [buyerCashNote2], // input notes 110
                [buyerCashNote3, buyerCashNote4], // output notes 30 + 80 = 110
                buyer.address,
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
            splitProofData = splitProof.encodeABI(buyerCash.address)
            splitProofSignatures = splitProof.constructSignatures(
                buyerCash.address,
                [buyer]
            )
        })
        test("Constructs second proof to send buyer's 30 note to the seller using the notary", async () => {
            sellerCashNote2 = await note.create(seller.publicKey, 30)
            holdProof = new JoinSplitProof(
                [buyerCashNote3], // input notes 100
                [sellerCashNote2], // output notes 100
                buyerCash.address,
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
        })
        test("Buyer holds 30 cash tokens for the seller using a notary", async () => {
            const expiration = addDays(new Date(), 2)
            const holdSignature = aztecSigner.signHoldForProof(
                buyerCash.address,
                holdProof.eth.output,
                notary.address,
                epochSeconds(expiration),
                hashLock.hash,
                buyer.privateKey
            )
            const holdProofData = holdProof.encodeABI(buyerCash.address)
            const tx = await buyerCash.splitAndHoldProofs(
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
            expect(receipt.events[3].event).toEqual("NewHold")
            expect(receipt.events[3].args.sender).toEqual(buyer.address)
            expect(receipt.events[3].args.lockHash).toEqual(hashLock.hash)
            expect(receipt.events[3].args.notary).toEqual(notary.address)
            expect(receipt.events[3].args.inputNoteHashes).toHaveLength(1)
            expect(receipt.events[3].args.outputNoteHashes).toHaveLength(1)
            expect(receipt.events[3].args.holdId).toMatch(bytes32)
            holdId = receipt.events[3].args.holdId
        })
        test("Validate on-chain note statuses", async () => {
            expect.assertions(4)
            expect(
                (
                    await aceContract.getNote(
                        buyerCash.address,
                        buyerCashNote2.noteHash
                    )
                ).status
            ).toEqual(2) // SPENT
            expect(
                (
                    await aceContract.getNote(
                        buyerCash.address,
                        buyerCashNote3.noteHash
                    )
                ).status
            ).toEqual(1) // UNSPENT
            try {
                await aceContract.getNote(
                    buyerCash.address,
                    sellerCashNote2.noteHash
                )
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch("expected note to exist")
            }
        })
        test("Notary executes the hold", async () => {
            const tx = await notaryCash["executeHold(bytes32,bytes32)"](
                holdId,
                hashLock.secret
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })
        test("Validate on-chain note statuses", async () => {
            expect(
                (
                    await aceContract.getNote(
                        buyerCash.address,
                        buyerCashNote3.noteHash
                    )
                ).status
            ).toEqual(2) // SPENT
            expect(
                (
                    await aceContract.getNote(
                        buyerCash.address,
                        sellerCashNote2.noteHash
                    )
                ).status
            ).toEqual(1) // UNSPENT
        })
    })
})
