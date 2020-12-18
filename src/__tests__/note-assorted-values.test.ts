// tslint:disable:no-console
import { proofs } from "@aztec/dev-utils"
import secp256k1 from "@aztec/secp256k1"
import {
    JoinSplitProof,
    MintProof,
    note,
} from "aztec.js"
import {ethers, Signer} from "ethers"
import nacl from "tweetnacl"
import {
    METADATA_AZTEC_DATA_LENGTH
} from "../chain/aztec/constants"
import { compilerOutput as zkAssetLinkedTokenCompilerOutput } from "../chain/contracts/ZkAssetLinkedTokenContract"
import AceMigator from "../chain/migration/1_ace"
import SimpleTokenMigator from "../chain/migration/2_simpleToken"
import migratorFactory, { Migrator } from "../chain/migration/migrator"
import { ACE, SimpleToken, ZkAssetLinkedToken } from "../chain/types"
import { WalletSigner } from "../chain/wallet/WalletSigner"
import configPromise from "../config/index"
import { EthersMatchers } from "../utils/jest"
import {
    ethereumAddress,
    transactionHash,
} from "../utils/regEx"

jest.setTimeout(60000) // timeout for each test in milliseconds
// Extend the Jest matchers with Ethers BigNumber matchers like toEqualBN
expect.extend(EthersMatchers)

const issuer = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000001"
)
const distributor = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000002"
)
const bank1 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000003"
)
const bank2 = secp256k1.accountFromPrivateKey(
  "0x0000000000000000000000000000000000000000000000000000000000000004"
)
const user1 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000005"
)
const user2 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000006"
)
const regulator = secp256k1.accountFromPrivateKey(
  "0x0000000000000000000000000000000000000000000000000000000000000007"
)



describe("Set up contracts, confidential Mint a variety of notes and validate output notes", () => {
    let aceContract: ACE
    let migrator: Migrator
    let issuerSigner: Signer
    let distributorSigner: Signer
    let bank1Signer: Signer
    let bank2Signer: Signer
    let user1Signer: Signer
    let user2Signer: Signer
    let issuerZkAsset: ZkAssetLinkedToken
    let distributorZkAsset: ZkAssetLinkedToken
    let bank1ZkAsset: ZkAssetLinkedToken
    let publicToken: SimpleToken

    const regulatorLinkedKeyPair = nacl.box.keyPair()
    const regulatorLinkedAccount = {
        address: regulator.address,
        linkedPublicKey: ethers.utils.hexlify(
          regulatorLinkedKeyPair.publicKey
        ),
    }
    //Loops spin up more Listeners than is usual
    process.setMaxListeners(15);

    beforeAll(async () => {
        const config = await configPromise
        if (!config?.chain?.wallet) {
            throw Error(`Failed to load config for chain.wallet.`)
        }
        const issuerWallet = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: issuer.privateKey,
        })
        migrator = await migratorFactory(issuerWallet)
        issuerSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: issuer.privateKey,
        })
        distributorSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: distributor.privateKey,
        })
        bank1Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: bank1.privateKey,
        })
        bank2Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: bank2.privateKey,
        })
        user1Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: user1.privateKey,
        })
        user2Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: user2.privateKey,
        })
    })
    describe('Deploy contracts', () => {
        test("Deploy proof contracts and ACE", async () => {
            aceContract = await AceMigator(migrator)
            expect(aceContract.address).toMatch(ethereumAddress)
        })
        test("Deploy public ERC20 token", async () => {
            publicToken = await SimpleTokenMigator(migrator)
            expect(publicToken.address).toMatch(ethereumAddress)
            expect(publicToken).not.toEqual(aceContract.address)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(0)
        })
        test("Deploy a zero-knowledge asset linked to token", async () => {
            issuerZkAsset = await migrator.deploy<ZkAssetLinkedToken>(
                zkAssetLinkedTokenCompilerOutput,
                aceContract.address,
                publicToken.address,
                1
            )
            expect(issuerZkAsset.address).toMatch(ethereumAddress)
            distributorZkAsset = issuerZkAsset.connect(distributorSigner)
            bank1ZkAsset = issuerZkAsset.connect(bank1Signer)

            // Check the zk asset is registered in the ACE note registry
            const registry = await aceContract.getRegistry(issuerZkAsset.address)
            expect(registry.linkedToken).toEqual(publicToken.address)
            expect(registry.scalingFactor).toEqualBN(1)
            expect(registry.totalSupplemented).toEqualBN(0)
            expect(registry.totalSupply).toEqualBN(0)
        })
        test("Add zk-asset as minter of public tokens", async () => {
            const tx = await publicToken.addMinter(issuerZkAsset.address)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(await publicToken.isMinter(issuerZkAsset.address)).toBeTruthy()
        })
    })
    
    describe("Masked receivers", () => {
        let outputNotePromises
        let sumOfNotes
        let netMintValueNote
        let outputNotes
        let mintNote
        let mintNoteValue = 1000000;
        let zeroValueNote
        let bank1CreateNoteEventArgs
        let randomNumbers
        let events

        test("Mint a large amount to use in joinSplits", async () => {

            zeroValueNote = await note.createZeroValueNote()
            netMintValueNote = await note.create(issuer.publicKey, mintNoteValue)
            mintNote = await note.create(issuer.publicKey, mintNoteValue)

            const mintProof = new MintProof(
                zeroValueNote,  // previous sum of all notes
                netMintValueNote,   // new sum of all notes
                [mintNote],          // new minted note
                issuer.address        // sender
              )
              const mintData = mintProof.encodeABI()
              const tx = await issuerZkAsset.confidentialMint(
                proofs.MINT_PROOF,
                mintData
              )
              expect(tx.hash).toMatch(transactionHash)
              const receipt = await tx.wait()
              expect(receipt.status).toEqual(1)
        })

        test("JoinSplit various amounts from the minted note", async () => {
            outputNotePromises = [];
            sumOfNotes = 0;
            randomNumbers = [];
            let lengthOfArray = 10;
            //Create values 1-5
            for(var i = 0; i <= 5; i++) {
                outputNotePromises.push(
                    note.create(
                        bank1.publicKey,
                        i,
                        [regulatorLinkedAccount]
                    )
                );
                sumOfNotes += i;
            }

            //Create  random Values and record them, 10 numbers, max value 100K each
            randomNumbers = Array.from({length: lengthOfArray}, () => Math.floor(Math.random() * 100000));
            for(var i = 0; i < lengthOfArray; i++) {
                outputNotePromises.push(
                    note.create(
                        bank1.publicKey,
                        randomNumbers[i],
                        [regulatorLinkedAccount]
                    )
                );
                sumOfNotes += randomNumbers[i];
            }
            //Remainder Note back to issuer
            outputNotePromises.push(
                note.create(
                    issuer.publicKey,
                    mintNoteValue - sumOfNotes,
                    [regulatorLinkedAccount]
                )
            )

            outputNotes = await Promise.all(outputNotePromises)
            const sendProof = new JoinSplitProof(
                [mintNote],  // input notes
                outputNotes,         // output notes
                issuer.address,       // tx sender
                0, // public token amount
                publicToken.address // public token owner
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
            //1 Destroyed note, 6 (0-5) range notes, 10 random value notes, one remainder note
            expect(receipt.events).toHaveLength(18)
            
        })
        test("Known failure case of extracting 0 value note", async () => {
            const filter = distributorZkAsset.filters.CreateNote(
                bank1.address,
                null,
                null
            )
            events = await bank1ZkAsset.queryFilter(filter)
            //Length of 16: 6 range notes, 10 random vaue notes
            expect(events.length).toEqual(16)
            bank1CreateNoteEventArgs = events[0].args
            const eventNote = await note.fromEventLog(
                bank1CreateNoteEventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                bank1.privateKey
            )
            expect(eventNote.noteHash).toEqual(outputNotes[0].noteHash)
            expect(eventNote.owner).toEqual(bank1.address)
            expect(eventNote.k.toNumber()).toEqual(0)
        })
        
        test("Test 1-5 range", async () => {
            for(var i = 0; i < 5; i++) {
                bank1CreateNoteEventArgs = events[i+1].args
                const eventNote = await note.fromEventLog(
                    bank1CreateNoteEventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                    bank1.privateKey
                )
                expect(eventNote.noteHash).toEqual(outputNotes[i+1].noteHash)
                expect(eventNote.owner).toEqual(bank1.address)
                expect(eventNote.k.toNumber()).toEqual(i+1)
            }

        })
        
        test("Test random values", async () => {
            for(var i = 0; i < 10; i++) {
                bank1CreateNoteEventArgs = events[i+6].args
                const eventNote = await note.fromEventLog(
                    bank1CreateNoteEventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                    bank1.privateKey
                )
                expect(eventNote.noteHash).toEqual(outputNotes[i+6].noteHash)
                expect(eventNote.owner).toEqual(bank1.address)
                expect(eventNote.k.toNumber()).toEqual(randomNumbers[i])
            }
        })
    })
})