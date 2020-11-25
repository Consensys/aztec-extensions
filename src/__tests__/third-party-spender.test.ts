import { proofs } from "@aztec/dev-utils"
import * as noteAccess from "@aztec/note-access"
import secp256k1 from "@aztec/secp256k1"
import { JoinSplitProof, MintProof, note, signer } from "aztec.js"
import { ethers, Signer, Wallet } from "ethers"
import { keccak256 } from "ethers/lib/utils"
import nacl from "tweetnacl"
import {
    AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH,
    AZTEC_JS_METADATA_PREFIX_LENGTH,
} from "../chain/aztec/constants"
import { EncryptedViewingKey } from "../chain/aztec/EncryptedViewingKey"
import AceMigator from "../chain/migration/1_ace"
import ZkAssetDirectMigrator from "../chain/migration/3_zkAssetDirect"
import NoteEscrowMigrator from "../chain/migration/5_noteEscrow"
import migratorFactory, { Migrator } from "../chain/migration/migrator"
import { ACE, NoteEscrow, ZkAssetDirect } from "../chain/types"
import { zeroAddress } from "../chain/utils/addresses"
import { WalletSigner } from "../chain/wallet/WalletSigner"
import configPromise from "../config/index"
import { EthersMatchers } from "../utils/jest"
import { bytesFixed, ethereumAddress, transactionHash } from "../utils/regEx"
const { metadata: metaDataConstructor } = noteAccess

jest.setTimeout(60000) // timeout for each test in milliseconds
// Extend the Jest matchers with Ethers BigNumber matchers like toEqualBN
expect.extend(EthersMatchers)

// 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
const deployer = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000001"
)
const account2 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000002"
)
const account3 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000003"
)
const account4 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000004"
)
const account5 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000005"
)

describe("Third party and contract approvals to spend a note", () => {
    let aceContract: ACE
    let account2AceContract: ACE
    let account3AceContract: ACE
    let account5AceContract: ACE
    let migrator: Migrator
    let account2Signer: Signer
    let account3Signer: Signer
    let account4Signer: Signer
    let account5Signer: Signer
    let asset: ZkAssetDirect
    let account2Asset: ZkAssetDirect
    let account3Asset: ZkAssetDirect
    let account4Asset: ZkAssetDirect
    let account5Asset: ZkAssetDirect
    let account2AssetNote1
    let account2AssetNote2
    let account3AssetNote1
    let account3AssetNote2
    let account4AssetNote1
    let account4AssetNote2
    let account5AssetNote1
    let account5AssetNote2
    let noteEscrow: NoteEscrow
    let account2NoteEscrow: NoteEscrow
    let account3NoteEscrow: NoteEscrow
    let account5NoteEscrow: NoteEscrow
    let mintReceipt

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
        account2Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: account2.privateKey,
        })
        account3Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: account3.privateKey,
        })
        account4Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: account4.privateKey,
        })
        account5Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: account5.privateKey,
        })
    })

    describe("Test setup", () => {
        test("Deploy proof contracts and ACE", async () => {
            aceContract = await AceMigator(migrator)
            expect(aceContract.address).toMatch(ethereumAddress)
            account2AceContract = aceContract.connect(account2Signer)
            account3AceContract = aceContract.connect(account3Signer)
            account5AceContract = aceContract.connect(account5Signer)
            expect(await account5Signer.getAddress()).toEqual(account5.address)
        })

        test("Deploy adjustable zero-knowledge asset", async () => {
            asset = await ZkAssetDirectMigrator(migrator, aceContract.address)
            account2Asset = asset.connect(account2Signer)
            account3Asset = asset.connect(account3Signer)
            account4Asset = asset.connect(account4Signer)
            account5Asset = asset.connect(account5Signer)
        })

        test("Mint 100 and 150 notes to account 2; 200 and 220 to account 3", async () => {
            account2AssetNote1 = await note.create(account2.publicKey, 100)
            account2AssetNote2 = await note.create(account2.publicKey, 150)
            account3AssetNote1 = await note.create(account3.publicKey, 200)
            account3AssetNote2 = await note.create(account3.publicKey, 220)
            account5AssetNote1 = await note.create(account5.publicKey, 400)
            account5AssetNote2 = await note.create(account5.publicKey, 420)
            const zeroValueNote = await note.createZeroValueNote()
            const newTotalValueAssetNote1 = await note.create(
                deployer.publicKey,
                1490 // 100 + 150 + 200 + 220 + 400 + 420
            )
            const mintProof = new MintProof(
                zeroValueNote,
                newTotalValueAssetNote1,
                [
                    account2AssetNote1,
                    account2AssetNote2,
                    account3AssetNote1,
                    account3AssetNote2,
                    account5AssetNote1,
                    account5AssetNote2,
                ],
                deployer.address
            )
            const mintData = mintProof.encodeABI()
            const tx = await asset.confidentialMint(proofs.MINT_PROOF, mintData)
            mintReceipt = await tx.wait()
            expect(mintReceipt.status).toEqual(1)
        })

        test("Deploy note escrow contract", async () => {
            noteEscrow = await NoteEscrowMigrator(migrator, aceContract.address)
            expect(noteEscrow.address).toMatch(ethereumAddress)
            account2NoteEscrow = noteEscrow.connect(account2Signer)
            account3NoteEscrow = noteEscrow.connect(account3Signer)
            account5NoteEscrow = noteEscrow.connect(account5Signer)
        })
    })

    describe("Account 5 spends account 3's note of value 200 to account 4 using confidentialApprove", () => {
        test("Account 3 approves account 5 to spend their note of value 200", async () => {
            expect(
                await account3Asset.confidentialApproved(
                    account3AssetNote1.noteHash,
                    account5.address
                )
            ).toBeFalsy()
            const approvalSignature = signer.signNoteForConfidentialApprove(
                asset.address,
                account3AssetNote1.noteHash,
                account5.address,
                true,
                account3.privateKey
            )
            const tx = await account3Asset.confidentialApprove(
                account3AssetNote1.noteHash,
                account5.address,
                true,
                approvalSignature
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            // check the note is approved after the approval
            expect(
                await account3Asset.confidentialApproved(
                    account3AssetNote1.noteHash,
                    account5.address
                )
            ).toBeTruthy()
        })
        let joinSplitProof
        test("Account 5 sends join split proof to spend account 3's note of value 200", async () => {
            account4AssetNote1 = await note.create(account4.publicKey, 200)
            joinSplitProof = new JoinSplitProof(
                [account3AssetNote1], // input notes 200
                [account4AssetNote1], // output notes 200
                account5.address, // sender
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
            const joinSplitData = joinSplitProof.encodeABI(asset.address)
            const tx = await account5AceContract.validateProof(
                proofs.JOIN_SPLIT_PROOF,
                // Must be sent by the spending account.
                // The transaction will success if not account 5 but the proof will not be registered
                account5.address,
                joinSplitData
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })
        test("Validate join split proof by hash", async () => {
            expect(
                await aceContract.validateProofByHash(
                    proofs.JOIN_SPLIT_PROOF,
                    joinSplitProof.hash,
                    account5.address
                )
            ).toBeTruthy()
        })
        test("Account 5 sends confidentialTransferFrom to spend account 3's note of value 200", async () => {
            const tx = await account5Asset.confidentialTransferFrom(
                proofs.JOIN_SPLIT_PROOF,
                joinSplitProof.eth.output
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })
        test("Account 3's note with value 200 has been spent", async () => {
            const registryNote = await aceContract.getNote(
                asset.address,
                account3AssetNote1.noteHash
            )
            expect(registryNote.status).toEqual(2) // SPENT
            expect(registryNote.noteOwner).toEqual(account3.address)
        })
        test("Account 4's note with value 200 is unspent", async () => {
            const registryNote = await aceContract.getNote(
                asset.address,
                account4AssetNote1.noteHash
            )
            expect(registryNote.status).toEqual(1) // UNSPENT
            expect(registryNote.noteOwner).toEqual(account4.address)
        })
    })

    describe("Account 5 spends account 3's note of value 220 to account 4 using approveProof", () => {
        let joinSplitProof
        test("Constructs JoinSplit proof to send its 220 value note to account 4 sent by account 5", async () => {
            account4AssetNote2 = await note.create(account4.publicKey, 220)
            joinSplitProof = new JoinSplitProof(
                [account3AssetNote2], // input notes 220
                [account4AssetNote2], // output notes 220
                account5.address, // sender
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
        })
        test("Account 3 approves proof against the asset", async () => {
            expect(
                await account5Asset.confidentialApproved(
                    keccak256(joinSplitProof.eth.output),
                    account5.address
                )
            ).toBeFalsy()
            const proofSignature = signer.signApprovalForProof(
                asset.address,
                joinSplitProof.eth.outputs,
                account5.address,
                true,
                account3.privateKey
            )
            const tx = await account3Asset.approveProof(
                proofs.JOIN_SPLIT_PROOF,
                joinSplitProof.eth.outputs,
                account5.address,
                true,
                proofSignature
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(
                await account5Asset.confidentialApproved(
                    keccak256(joinSplitProof.eth.output),
                    account5.address
                )
            ).toBeTruthy()
        })
        test("Account 5 validates proof with ACE", async () => {
            expect(
                await aceContract.validateProofByHash(
                    proofs.JOIN_SPLIT_PROOF,
                    joinSplitProof.hash,
                    account5.address
                )
            ).toBeFalsy()
            const joinSplitData = joinSplitProof.encodeABI(asset.address)
            const tx = await account5AceContract.validateProof(
                proofs.JOIN_SPLIT_PROOF,
                account5.address,
                joinSplitData
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(
                await aceContract.validateProofByHash(
                    proofs.JOIN_SPLIT_PROOF,
                    joinSplitProof.hash,
                    account5.address
                )
            ).toBeTruthy()
        })
        test("Account 5 sends confidentialTransferFrom to spend account 3's note of value 220", async () => {
            const tx = await account5Asset.confidentialTransferFrom(
                proofs.JOIN_SPLIT_PROOF,
                joinSplitProof.eth.output
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })
        test("Account 3's note with value 220 has been spent", async () => {
            const registryNote = await aceContract.getNote(
                asset.address,
                account3AssetNote2.noteHash
            )
            expect(registryNote.status).toEqual(2) // SPENT
            expect(registryNote.noteOwner).toEqual(account3.address)
        })
        test("Account 4's note with value 220 is unspent", async () => {
            const registryNote = await aceContract.getNote(
                asset.address,
                account4AssetNote2.noteHash
            )
            expect(registryNote.status).toEqual(1) // UNSPENT
            expect(registryNote.noteOwner).toEqual(account4.address)
        })
    })

    describe("Smart contract controls a note owned by account 2 by being the proof sender", () => {
        describe("proofs submitted by account 2", () => {
            let joinSplitProof
            test(
                "Construct join split proof for the transfer of Account 2's 100 value note " +
                    "to account 3 sent by the NoteEscrow contract",
                async () => {
                    const account3AssetNote3 = await note.create(
                        account3.publicKey,
                        100
                    )
                    joinSplitProof = new JoinSplitProof(
                        [account2AssetNote1], // input notes 100
                        [account3AssetNote3], // output notes 100
                        noteEscrow.address, // sender is the Note Escrow contract
                        0, // deposit (negative), withdrawal (positive) or transfer (zero)
                        zeroAddress // token owner. Only relevant for deposits or withdrawals
                    )
                }
            )
            test("Account 2 approves proof, Account 3 submits the proof to the asset", async () => {
                expect(
                    await account3Asset.confidentialApproved(
                        keccak256(joinSplitProof.eth.output),
                        noteEscrow.address
                    )
                ).toBeFalsy()
                const proofSignature = signer.signApprovalForProof(
                    asset.address,
                    joinSplitProof.eth.outputs,
                    noteEscrow.address,
                    true,
                    account2.privateKey
                )
                const tx = await account3Asset.approveProof(
                    proofs.JOIN_SPLIT_PROOF,
                    joinSplitProof.eth.outputs,
                    noteEscrow.address,
                    true,
                    proofSignature
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(
                    await account3Asset.confidentialApproved(
                        keccak256(joinSplitProof.eth.output),
                        noteEscrow.address
                    )
                ).toBeTruthy()
            })
            test("Account 2 validates proof with ACE via the NoteEscrow contract", async () => {
                expect(
                    await aceContract.validateProofByHash(
                        proofs.JOIN_SPLIT_PROOF,
                        joinSplitProof.hash,
                        noteEscrow.address
                    )
                ).toBeFalsy()
                const joinSplitData = joinSplitProof.encodeABI(asset.address)
                const tx = await account2NoteEscrow.validateProof(
                    proofs.JOIN_SPLIT_PROOF,
                    joinSplitData
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(
                    await aceContract.validateProofByHash(
                        proofs.JOIN_SPLIT_PROOF,
                        joinSplitProof.hash,
                        noteEscrow.address
                    )
                ).toBeTruthy()
            })
            test("Account 3 calls NoteEscrow contract to transfer Account 2's 100 note", async () => {
                const tx = await account3NoteEscrow.confidentialTransferFrom(
                    asset.address,
                    proofs.JOIN_SPLIT_PROOF,
                    joinSplitProof.eth.output
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })
        })

        describe("proofs submitted by Account 5", () => {
            let joinSplitProof
            test(
                "Construct join split proof for the transfer of Account 2's 150 value note " +
                    "to account 3 sent by the NoteEscrow contract",
                async () => {
                    const account3AssetNote4 = await note.create(
                        account3.publicKey,
                        150
                    )
                    joinSplitProof = new JoinSplitProof(
                        [account2AssetNote2], // input notes 150
                        [account3AssetNote4], // output notes 150
                        noteEscrow.address, // sender is the Note Escrow contract
                        0, // deposit (negative), withdrawal (positive) or transfer (zero)
                        zeroAddress // token owner. Only relevant for deposits or withdrawals
                    )
                }
            )
            test("Account 2 approves proof against the asset and account 5 sends the proof", async () => {
                expect(
                    await account5Asset.confidentialApproved(
                        keccak256(joinSplitProof.eth.output),
                        noteEscrow.address
                    )
                ).toBeFalsy()
                const proofSignature = signer.signApprovalForProof(
                    asset.address,
                    joinSplitProof.eth.outputs,
                    noteEscrow.address,
                    true,
                    account2.privateKey
                )
                const tx = await account5Asset.approveProof(
                    proofs.JOIN_SPLIT_PROOF,
                    joinSplitProof.eth.outputs,
                    noteEscrow.address,
                    true,
                    proofSignature
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(
                    await account5Asset.confidentialApproved(
                        keccak256(joinSplitProof.eth.output),
                        noteEscrow.address
                    )
                ).toBeTruthy()
            })
            test("Account 5 validates proof with ACE via the NoteEscrow contract", async () => {
                expect(
                    await aceContract.validateProofByHash(
                        proofs.JOIN_SPLIT_PROOF,
                        joinSplitProof.hash,
                        noteEscrow.address
                    )
                ).toBeFalsy()
                const joinSplitData = joinSplitProof.encodeABI(asset.address)
                const tx = await account5NoteEscrow.validateProof(
                    proofs.JOIN_SPLIT_PROOF,
                    joinSplitData
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(
                    await aceContract.validateProofByHash(
                        proofs.JOIN_SPLIT_PROOF,
                        joinSplitProof.hash,
                        noteEscrow.address
                    )
                ).toBeTruthy()
            })
            test("Account 5 calls NoteEscrow contract to transfer Account 2's 100 note", async () => {
                const tx = await account5NoteEscrow.confidentialTransferFrom(
                    asset.address,
                    proofs.JOIN_SPLIT_PROOF,
                    joinSplitProof.eth.output
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })
        })
    })

    describe("Smart contract owns a note", () => {
        let escrowContractNote1
        let proof
        const randomAccount = secp256k1.generateAccount()
        test("Construct proof to transfer ownership of Account 5's 400 value note to the note escrow contract", async () => {
            escrowContractNote1 = await note.create(
                randomAccount.publicKey,
                400, // note value
                // mapping of Ethereum addresses to note public keys
                // [account2],
                undefined,
                noteEscrow.address // note owner
            )
            proof = new JoinSplitProof(
                [account5AssetNote1], // input notes
                [escrowContractNote1], // output notes
                account5.address, // tx sender
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner. Only relevant for deposits or withdrawals
            )
        })
        test("Account 5 signs proof and calls confidentialTransfer", async () => {
            const proofData = proof.encodeABI(asset.address)
            const proofSignatures = proof.constructSignatures(asset.address, [
                account5,
            ])
            const tx = await account5Asset["confidentialTransfer(bytes,bytes)"](
                proofData,
                proofSignatures
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })
        test("Note in registry is owned by the note escrow contract", async () => {
            const readNote = await aceContract.getNote(
                asset.address,
                escrowContractNote1.noteHash
            )
            expect(readNote.noteOwner).toEqual(noteEscrow.address)
            expect(readNote.status).toEqual(1) // unspent
        })
        let account4AssetNote3
        test("Construct join split proof for escrow contract note to send note to account 4", async () => {
            account4AssetNote3 = await note.create(account4.publicKey, 400)
            proof = new JoinSplitProof(
                [escrowContractNote1], // input notes
                [account4AssetNote3], // output notes
                noteEscrow.address, // tx sender
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner. Only relevant for deposits or withdrawals
            )
        })
        test("Account 5 calls note escrow contract to send escrow contract note note to account 4", async () => {
            const proofData = proof.encodeABI(asset.address)
            const tx = await account5NoteEscrow.transferNote(
                asset.address,
                proofs.JOIN_SPLIT_PROOF,
                escrowContractNote1.noteHash,
                proofData
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })

        test("The note owned by the escrow contract in the registry has now been spent", async () => {
            const readNote = await aceContract.getNote(
                asset.address,
                escrowContractNote1.noteHash
            )
            expect(readNote.noteOwner).toEqual(noteEscrow.address)
            expect(readNote.status).toEqual(2) // spent
        })

        test("Account 4 now has an unspent note in the registry", async () => {
            const readNote = await aceContract.getNote(
                asset.address,
                account4AssetNote3.noteHash
            )
            expect(readNote.noteOwner).toEqual(account4.address)
            expect(readNote.status).toEqual(1) // unspent
        })
    })

    describe("Note view access control", () => {
        let existingNote
        beforeAll(() => {
            existingNote = account5AssetNote2
        })
        let updatedMetaData
        let linkedKeyPair
        test("Account 5 grants account 3 view access to its existing note", async () => {
            linkedKeyPair = nacl.box.keyPair()
            const access = [
                {
                    address: account3.address,
                    linkedPublicKey: ethers.utils.hexlify(
                        linkedKeyPair.publicKey
                    ),
                },
            ]
            existingNote.grantViewAccess(access)

            const metaDataPrefix = existingNote.metaData.slice(
                0,
                AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH + 2
            )
            const newMetaData =
                metaDataPrefix + existingNote.exportMetaData().slice(2)

            const tx = await account5Asset.updateNoteMetaData(
                existingNote.noteHash,
                newMetaData
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(1)
            expect(receipt.events[0].event).toEqual("UpdateNoteMetaData")
            expect(receipt.events[0].args.owner).toEqual(account5.address)
            expect(receipt.events[0].args.noteHash).toEqual(
                existingNote.noteHash
            )
            expect(
                receipt.events[0].args.metadata.slice(
                    AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH + 2
                )
            ).toEqual(existingNote.exportMetaData().slice(2).toLowerCase())
            updatedMetaData = receipt.events[0].args.metadata
        })
        test("Account 3 can view the note's value", async () => {
            expect(
                updatedMetaData.slice(
                    AZTEC_JS_METADATA_PREFIX_LENGTH +
                        AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH
                )
            ).toEqual(
                existingNote.metaData
                    .slice(AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH + 2)
                    .toLowerCase()
            )
            const metadataObj = metaDataConstructor(
                updatedMetaData.slice(
                    AZTEC_JS_METADATA_PREFIX_LENGTH +
                        AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH
                )
            )
            const allowedAccess = metadataObj.getAccess(account3.address)
            expect(allowedAccess).toBeDefined()
            const encryptedViewingKey = allowedAccess.viewingKey
            expect(encryptedViewingKey).toMatch(bytesFixed(210))
            const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                encryptedViewingKey
            )
            const decryptedViewingKey = viewingKey.decrypt(
                linkedKeyPair.secretKey
            )
            const decryptedNote = await note.fromViewKey(decryptedViewingKey)
            expect(decryptedNote.k.toNumber()).toEqual(
                account5AssetNote2.k.toNumber()
            )
        })
        test("Account 4 does not have an encrypted viewing key", async () => {
            const metadataObj = metaDataConstructor(
                updatedMetaData.slice(
                    AZTEC_JS_METADATA_PREFIX_LENGTH +
                        AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH
                )
            )
            const allowedAccess = metadataObj.getAccess(account4.address)
            expect(allowedAccess).toBeNull()
        })
        test("Account 4 can not decrypted account 3's encrypted viewing key using its private key", async () => {
            expect.assertions(2)
            const metadataObj = metaDataConstructor(
                updatedMetaData.slice(
                    AZTEC_JS_METADATA_PREFIX_LENGTH +
                        AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH
                )
            )
            const allowedAccess = metadataObj.getAccess(account3.address)
            const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                allowedAccess.viewingKey
            )
            try {
                viewingKey.decrypt(ethers.utils.arrayify(account4.privateKey))
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch(
                    "Failed to decrypt viewing key with private key"
                )
            }
        })
        test("Account 5 grants account 4 view access to its existing note", async () => {
            linkedKeyPair = nacl.box.keyPair()
            const access = [
                {
                    address: account4.address,
                    linkedPublicKey: ethers.utils.hexlify(
                        linkedKeyPair.publicKey
                    ),
                },
            ]
            existingNote.grantViewAccess(access)

            const metaDataPrefix = existingNote.metaData.slice(
                0,
                AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH + 2
            )
            const newMetaData =
                metaDataPrefix + existingNote.exportMetaData().slice(2)

            const tx = await account5Asset.updateNoteMetaData(
                existingNote.noteHash,
                newMetaData
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(1)
            expect(receipt.events[0].event).toEqual("UpdateNoteMetaData")
            expect(
                receipt.events[0].args.metadata.slice(
                    AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH + 2
                )
            ).toEqual(existingNote.exportMetaData().slice(2).toLowerCase())
        })
    })
})
