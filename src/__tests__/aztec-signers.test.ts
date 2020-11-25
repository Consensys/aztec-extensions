// tslint:disable:no-console
import { proofs } from "@aztec/dev-utils"
import secp256k1 from "@aztec/secp256k1"
import { BurnProof, JoinSplitProof, MintProof, note, signer } from "aztec.js"
import { Signer } from "ethers"
import { AZTEC_JS_METADATA_PREFIX_LENGTH } from "../chain/aztec/constants"
import AceMigator from "../chain/migration/1_ace"
import ZkAssetDirectMigrator from "../chain/migration/3_zkAssetDirect"
import migratorFactory, { Migrator } from "../chain/migration/migrator"
import { ACE, ZkAssetDirect } from "../chain/types"
import { zeroAddress } from "../chain/utils/addresses"
import { WalletSigner } from "../chain/wallet/WalletSigner"
import configPromise from "../config/index"
import { EthersMatchers } from "../utils/jest"
import { ethereumAddress, transactionHash } from "../utils/regEx"

jest.setTimeout(60000) // timeout for each test in milliseconds
// Extend the Jest matchers with Ethers BigNumber matchers like toEqualBN
expect.extend(EthersMatchers)

const issuer = secp256k1.generateAccount()
const bank1 = secp256k1.generateAccount()
const bank2 = secp256k1.generateAccount()
const agentBank = secp256k1.generateAccount()
const agentBankClient1 = secp256k1.generateAccount()

describe("Note owners separated from Ethereum transaction signers", () => {
    let aceContract: ACE
    let cbAce: ACE
    let bank1Ace: ACE
    let bank2Ace: ACE
    let deployerMigrator: Migrator
    let issuerMigrator: Migrator
    let issuerSigner: Signer
    let bank1Signer: Signer
    let bank2Signer: Signer
    let agentBankSigner: Signer

    beforeAll(async () => {
        const config = await configPromise
        if (!config?.chain?.wallet) {
            throw Error(`Failed to load config for chain.wallet.`)
        }
        const deployerSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            // 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
            privateKey:
                "0x0000000000000000000000000000000000000000000000000000000000000001",
        })
        deployerMigrator = await migratorFactory(deployerSigner)
        issuerSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey:
                "0x0000000000000000000000000000000000000000000000000000000000000003",
        })
        issuerMigrator = await migratorFactory(issuerSigner)
        bank1Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey:
                "0x0000000000000000000000000000000000000000000000000000000000000004",
        })
        bank2Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey:
                "0x0000000000000000000000000000000000000000000000000000000000000005",
        })
        agentBankSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey:
                "0x0000000000000000000000000000000000000000000000000000000000000006",
        })
    })

    test("Deploy proof contracts and ACE", async () => {
        aceContract = await AceMigator(deployerMigrator)
        expect(aceContract.address).toMatch(ethereumAddress)
        expect(await aceContract.latestEpoch()).toEqual(1)
        expect(
            await aceContract.getValidatorAddress(proofs.JOIN_SPLIT_PROOF)
        ).toMatch(ethereumAddress)
        cbAce = aceContract.connect(issuerSigner)
        bank1Ace = aceContract.connect(bank1Signer)
        bank2Ace = aceContract.connect(bank2Signer)
    })

    describe("Direct ZkAsset", () => {
        let zkAsset: ZkAssetDirect
        let cbZkAsset: ZkAssetDirect
        let bank1ZkAsset: ZkAssetDirect
        let bank2ZkAsset: ZkAssetDirect

        test("Issuer deploys a zero-knowledge direct asset", async () => {
            zkAsset = await ZkAssetDirectMigrator(
                issuerMigrator,
                aceContract.address
            )
            expect(zkAsset.address).toMatch(ethereumAddress)
            cbZkAsset = zkAsset.connect(issuerSigner)
            bank1ZkAsset = zkAsset.connect(bank1Signer)
            bank2ZkAsset = zkAsset.connect(bank2Signer)
        })

        let issuerNote1
        let issuerNote2
        const issuerNote1Value = 2000
        describe("Mint", () => {
            let issuerNote1Receipt
            test("Issuer mints issuer note 1", async () => {
                issuerNote1 = await note.create(
                    issuer.publicKey,
                    issuerNote1Value
                )
                const zeroMintCounterNote = await note.createZeroValueNote()
                const mintProof = new MintProof(
                    zeroMintCounterNote, // previous sum of all notes
                    issuerNote1, // new sum of all notes
                    [issuerNote1], // new minted notes
                    await issuerSigner.getAddress() // sender
                )

                const mintData = mintProof.encodeABI()

                const tx = await zkAsset.confidentialMint(
                    proofs.MINT_PROOF,
                    mintData
                )
                expect(tx.hash).toMatch(transactionHash)
                issuerNote1Receipt = await tx.wait()
                expect(issuerNote1Receipt.status).toEqual(1)
            })

            test("Check on-chain issuer note 1", async () => {
                const onChainNote = await cbAce.getNote(
                    cbZkAsset.address,
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
            })

            test("Issuer mints 200 note to bank 2, zero value notes for other participants", async () => {
                issuerNote2 = await note.create(issuer.publicKey, 0)
                const bank1Note0 = await note.create(bank1.publicKey, 0)
                const bank2Note0 = await note.create(bank2.publicKey, 200)
                const agentBank0 = await note.create(agentBank.publicKey, 0)
                const newTotalValueNote2 = await note.create(
                    issuer.publicKey,
                    2200
                )

                const mintProof = new MintProof(
                    issuerNote1,
                    newTotalValueNote2,
                    [issuerNote2, bank1Note0, bank2Note0, agentBank0],
                    await issuerSigner.getAddress()
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

        let issuerNote3
        let bank1Note1
        let bank2Note1
        describe("Transfers", () => {
            test("Issuer transfers tokens: 200 bank 1, 600 bank 2 and 1200 themselves", async () => {
                cbZkAsset = zkAsset.connect(issuerSigner)
                issuerNote3 = await note.create(issuer.publicKey, 1200)
                bank1Note1 = await note.create(bank1.publicKey, 200)
                expect(bank1Note1.owner).toEqual(bank1.address)
                expect(bank1Note1.k.toNumber()).toEqual(200)

                bank2Note1 = await note.create(bank2.publicKey, 600)
                expect(bank2Note1.owner).toEqual(bank2.address)
                expect(bank2Note1.k.toNumber()).toEqual(600)

                const sendProof = new JoinSplitProof(
                    [issuerNote1], // input notes
                    [issuerNote3, bank1Note1, bank2Note1], // output notes
                    await issuerSigner.getAddress(), // tx sender
                    0, // deposit (negative), withdrawal (positive) or transfer (zero)
                    zeroAddress // public token owner. Only relevant for deposits or withdrawals
                )
                const proofData = sendProof.encodeABI(cbZkAsset.address)
                const proofSignatures = sendProof.constructSignatures(
                    cbZkAsset.address,
                    [issuer]
                )
                const tx = await cbZkAsset["confidentialTransfer(bytes,bytes)"](
                    proofData,
                    proofSignatures
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })

            let eventNote
            test("bank 1 derives note from CreateNote event and sends ", async () => {
                // get CreateNote event for the note Bank 1 owns
                const filter = bank1ZkAsset.filters.CreateNote(
                    bank1.address,
                    null,
                    null
                )
                const events = await bank1ZkAsset.queryFilter(filter)
                expect(events).toHaveLength(2)
                expect(events[0].event).toEqual("CreateNote")
                expect(events[1].event).toEqual("CreateNote")
                expect(events[1].args.owner).toEqual(bank1.address)

                // Derive note from the first CreateNote event
                eventNote = await note.fromEventLog(
                    events[1].args.metadata,
                    bank1.privateKey
                )
                expect(eventNote.noteHash).toEqual(events[1].args.noteHash)
                expect(eventNote.metaData.slice(2)).toEqual(
                    events[1].args.metadata.slice(
                        AZTEC_JS_METADATA_PREFIX_LENGTH
                    )
                )
                expect(eventNote.k.toNumber()).toEqual(200)
                expect(eventNote.owner).toEqual(bank1.address)
            })

            let bank2Note2
            test("Bank 1 sends 30 to Bank 2 and 170 to themselves", async () => {
                bank2Note2 = await note.create(bank2.publicKey, 30)
                const bank1Note2 = await note.create(bank1.publicKey, 170)
                const sendProof = new JoinSplitProof(
                    [eventNote],
                    [bank1Note2, bank2Note2],
                    await bank1Signer.getAddress(),
                    0, // deposit (negative), withdrawal (positive) or transfer (zero)
                    zeroAddress // token owner. Only relevant for deposits or withdrawals
                )
                const proofData = sendProof.encodeABI(bank1ZkAsset.address)
                const proofSignatures = sendProof.constructSignatures(
                    bank1ZkAsset.address,
                    [bank1]
                )
                const tx = await bank1ZkAsset[
                    "confidentialTransfer(bytes,bytes)"
                ](proofData, proofSignatures)
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })

            describe("Bank 1 spends Bank 2's first 600 note after confidential approval", () => {
                let bank1Note3
                test("Bank 2 approves bank 1 to spend its first 600 value note", async () => {
                    expect(
                        await bank1ZkAsset.confidentialApproved(
                            bank2Note1.noteHash,
                            await bank1Signer.getAddress()
                        )
                    ).toBeFalsy()
                    const approvalSignature = signer.signNoteForConfidentialApprove(
                        zkAsset.address, // address of target contract
                        bank2Note1.noteHash, // noteHash of the note being signed
                        await bank1Signer.getAddress(), // spender address of the note spender
                        true, // boolean determining whether the spender is being granted approval
                        bank2.privateKey // the private key of message signer
                    )
                    const tx = await bank2ZkAsset.confidentialApprove(
                        bank2Note1.noteHash, // keccak256 hash of the note coordinates (gamma and sigma)
                        await bank1Signer.getAddress(), // address being approved to spend the note
                        // defines whether the _spender address is being approved to spend the note,
                        // or if permission is being revoked. True if approved, false if not approved
                        true,
                        approvalSignature // ECDSA signature from the note owner that validates the confidentialApprove() instruction
                    )
                    const receipt = await tx.wait()
                    expect(receipt.status).toEqual(1)
                    // check the note is approved after the approval
                    expect(
                        await bank1ZkAsset.confidentialApproved(
                            bank2Note1.noteHash,
                            await bank1Signer.getAddress()
                        )
                    ).toBeTruthy()
                })

                let joinSplitProof
                test("Bank 1 constructs and validates JoinSplit proof to spend 40 of Bank 2's 600 note", async () => {
                    bank1Note3 = await note.create(bank1.publicKey, 40)
                    const bank2Note3 = await note.create(bank1.publicKey, 560)
                    joinSplitProof = new JoinSplitProof(
                        [bank2Note1],
                        [bank1Note3, bank2Note3],
                        await bank1Signer.getAddress(),
                        0, // deposit (negative), withdrawal (positive) or transfer (zero)
                        zeroAddress // token owner. Only relevant for deposits or withdrawals
                    )
                    const joinSplitData = joinSplitProof.encodeABI(
                        bank1ZkAsset.address
                    )
                    const tx = await bank1Ace.validateProof(
                        proofs.JOIN_SPLIT_PROOF,
                        // Must be the address if the account sending the validateProof transaction
                        await bank1Signer.getAddress(),
                        joinSplitData
                    )
                    const receipt = await tx.wait()
                    expect(receipt.status).toEqual(1)
                })
                test("Validate join split proof by hash", async () => {
                    expect(
                        await aceContract.validateProofByHash(
                            proofs.JOIN_SPLIT_PROOF,
                            joinSplitProof.hash,
                            await bank1Signer.getAddress()
                        )
                    ).toBeTruthy()
                })
                test("Bank 1 sends confidentialTransferFrom to spend bank 2's note of value 600", async () => {
                    const tx = await bank1ZkAsset.confidentialTransferFrom(
                        proofs.JOIN_SPLIT_PROOF,
                        joinSplitProof.eth.output
                    )
                    const receipt = await tx.wait()
                    expect(receipt.status).toEqual(1)
                })
                test("Bank 2's note with value 600 has been spent", async () => {
                    const registryNote = await aceContract.getNote(
                        zkAsset.address,
                        bank2Note1.noteHash
                    )
                    expect(registryNote.status).toEqual(2) // SPENT
                    expect(registryNote.noteOwner).toEqual(bank2.address)
                })
                test("Account 1's note with value 40 is unspent", async () => {
                    const registryNote = await aceContract.getNote(
                        bank2ZkAsset.address,
                        bank1Note3.noteHash
                    )
                    expect(registryNote.status).toEqual(1) // UNSPENT
                    expect(registryNote.noteOwner).toEqual(bank1.address)
                })
            })
        })

        describe("Burn", () => {
            let firstBurnNewTotalValueNote
            test("Issuer burns issuer note of value 1200", async () => {
                const currentTotalValueNote = await note.createZeroValueNote()
                firstBurnNewTotalValueNote = await note.create(
                    issuer.publicKey,
                    1200
                )
                const burnProof = new BurnProof(
                    currentTotalValueNote,
                    firstBurnNewTotalValueNote,
                    [issuerNote3],
                    await issuerSigner.getAddress()
                )

                const burnData = burnProof.encodeABI()

                // Check the burnt note does not exist yet
                let burntNote = await aceContract.getNote(
                    zkAsset.address,
                    issuerNote3.noteHash
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
                    issuerNote3.noteHash
                )
                expect(burntNote.status).toEqual(2)
            })
        })
    })
})
