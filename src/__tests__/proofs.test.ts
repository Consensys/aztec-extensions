/* tslint:disable:no-console */
import { proofs } from "@aztec/dev-utils"
import secp256k1 from "@aztec/secp256k1"
import { JoinSplitProof, MintProof, note } from "aztec.js"
import { compilerOutput as zkZkProofTestingCompilerOutput } from "../chain/contracts/ZkProofTestingContract"
import AceMigator from "../chain/migration/1_ace"
import migratorFactory, { Migrator } from "../chain/migration/migrator"
import { ACE, ZkProofTesting } from "../chain/types"
import { zeroAddress } from "../chain/utils/addresses"
import { WalletSigner } from "../chain/wallet/WalletSigner"
import configPromise from "../config/index"
import { EthersMatchers } from "../utils/jest"
import { ethereumAddress } from "../utils/regEx"

jest.setTimeout(60000) // timeout for each test in milliseconds
// Extend the Jest matchers with Ethers BigNumber matchers like toEqualBN
expect.extend(EthersMatchers)

const deployer = secp256k1.generateAccount()
const seller = secp256k1.generateAccount()
const buyer = secp256k1.generateAccount()
const notary = secp256k1.generateAccount()

describe("Aztec proofs", () => {
    let aceContract: ACE
    let migrator: Migrator
    let proofTesting: ZkProofTesting

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
    })

    describe("Deploy contracts", () => {
        test("Deploy proof contracts and ACE", async () => {
            aceContract = await AceMigator(migrator)
            expect(aceContract.address).toMatch(ethereumAddress)
            expect(await aceContract.latestEpoch()).toEqual(1)
            expect(
                await aceContract.getValidatorAddress(proofs.JOIN_SPLIT_PROOF)
            ).toMatch(ethereumAddress)
        })
        test("Deploy proof testing contract", async () => {
            proofTesting = await migrator.deploy<ZkProofTesting>(
                zkZkProofTestingCompilerOutput,
                aceContract.address,
                1
            )
        })
    })
    describe("ABI encoded proofs", () => {
        let inputNote1
        let outputNote1
        let joinSplitProof
        let proofData
        beforeAll(async () => {
            inputNote1 = await note.create(seller.publicKey, 100)
            outputNote1 = await note.create(buyer.publicKey, 100)
            joinSplitProof = new JoinSplitProof(
                [inputNote1], // input notes 100
                [outputNote1], // output notes 100
                notary.address, // the confidentialTransferFrom comes from the ZkAsset
                0, // deposit (negative), withdrawal (positive) or transfer (zero)
                zeroAddress // public token owner
            )
            proofData = joinSplitProof.encodeABI(proofTesting.address)
        })
        test("extract proofs from ABI encoded proof data", async () => {
            const result = await proofTesting.callStatic.extractProofs(
                proofs.JOIN_SPLIT_PROOF,
                notary.address,
                proofData
            )
            expect(result).toHaveLength(1)
            expect(result[0]).toHaveLength(joinSplitProof.eth.output.length)
            expect(result[0].toUpperCase()).toEqual(
                joinSplitProof.eth.output.toUpperCase()
            )
            console.log(`proofData: ${proofData}`)
            console.log(`eth.outputs: ${joinSplitProof.eth.outputs}`)
            console.log(`eth.output: ${joinSplitProof.eth.output}`)
        })
        test("Extract notes from eth.output", async () => {
            const result = await proofTesting.callStatic.extractNotes(
                proofs.JOIN_SPLIT_PROOF,
                joinSplitProof.eth.output
            )
            expect(result).toBeDefined()
            expect(result.inputNotesCount).toEqualBN(1)
            expect(result.outputNotesCount).toEqualBN(1)
            expect(result.inputNotesData).toHaveLength(1)
            expect(result.inputNotesData[0].owner).toEqual(seller.address)
            expect(result.inputNotesData[0].noteHash).toEqual(
                inputNote1.noteHash
            )
            // expect(result.inputNotesData[0].metadata).toEqual(
            //     inputNote1.exportMetaData()
            // )
            expect(result.outputNotesData).toHaveLength(1)
        })
    })
})
