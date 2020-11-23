# Introduction to the Aztec Protocol

## Why AZTEC?

The Anonymous Zero-knowledge Transactions with Efficient Communications (AZTEC) Protocol allows confidential value transfers on an Ethereum blockchain. Only the participants of the transfer can see the before and after token balances and the transfer values. By using zero-knowledge proofs, anyone can verify the integrity of the transfer without knowing what the token balances and transfer values. That is, anyone can verify that value is not being double-spent.

## What are Zero-Knowledge Proofs?

The inner works of zero-knowledge proofs are difficult to understand, but at a surface level, they are relatively straight forward. They ensure operations on encrypted amounts are mathematically correct without knowing the decrypted amounts. For example, the sum of two different encrypted amounts equals another encrypted amount. The prover does not know what the decrypted amounts are, but they can prove the maths on the encrypted amounts is mathematically correct. This is called homomorphic encryption.

An example in the Aztec Protocol is the sum of encrypted input amounts equals the sum of encrypted output amounts which ensures there are no double-spending in the Aztec Protocol.

## What is AZTEC?

AZTEC uses an unspent transaction output (UTXO) model like Bitcoin and Corda as opposed to an account model like Ethereum or ERC20 tokens. It does this with Aztec notes that have an amount of tokens owned by an Ethereum account. The Aztec note value (an amount of tokens), is encrypted and can only be decrypted by the note owner or an account granted view access to the note. Everyone else will not be able to read the decrypted value but can see the account owning the note and accounts with view access.

The value and owner of an Aztec note can not be changed. To move value to another note owner, or to change the note value held by a note owner, an Aztec join split proof is used. A set of input notes are spent to create a new set of unspent output notes. The number of input and output notes is flexible; the only rule is the sum of the input note values has to equal the sum of the output note values. This is enforced by a zero-knowledge proof to ensure no double-spend of tokens. Once the input notes are used in a join split proof, they are marked as spent so they can not be reused in another proof.

![JoinSplit](./JoinSplit.png?style=centerme)

For example, Alice owns two unspent notes with token values 100 and 200. She needs to pay Bob 120 tokens.
Alice will construct a join split with her two unspent notes and will create two new unspent notes:

1. 120 value note owned by Bob.
2. 180 value note owned by Alice.
   As the input note values (100 + 200) equals the output note values (120 + 180), this join split is valid.

In the above example, Alice's value note could have been used as a single input to the join split. This would result in Alice having two unspent notes of values 100 and 80 instead of a single 180 unspent note in the example.

To create a new Aztec note, the public key of the note owner's account is used. Randomness is added so any two notes created with the same owner public key and value will generate different encrypted notes. Only the note owner can decrypt the note using their account's private key.
View access to a note can be granted to other accounts in a similar way using their public key. Granting view access to a note can be done after the note is created but the owner can never be changed.

Aztec notes are attached to a zero-knowledge asset. Like a token, these assets represent a fungible value. For example a currency, commodity, security, loyalty points, game credits, time or anything that is of value. Also like a token, there are a number of operations that can be done against a zero-knowledge asset: mint, burn, transfer, approve and transferFrom.

Zero-knowledge assets can be linked to a standard ERC20 token which can be converted to into notes. That is, value can only be created by the zero-knowledge asset taking ownership of the ERC20 token. An adjustable zero-knowledge asset does not have this restriction. The asset owner can create or remove value without being linked to any ERC20 token.

## Zero-Knowledge Asset Operations

### Mint

The zero-knowledge asset owner can mint new Aztec notes using the Mint proof. The is creating new tokens that didn't exist before.

The Mint proof accepts four parameters:

- **currentTotalValueNote** previous sum of all minted notes which will have zero value on the first mint.
- **newTotalValueNote** new sum of all minted notes. This note must be kept for the next mint proof to work. Constructing another note with the same value and owner will not work as it'll have a different hash.
- **mintedNotes** list of new notes to be minted.
- **sender** the account that will send the `confidentialMint` transaction to the zero-knowledge asset contract. This must be the zero-knowledge asset contract owner which is usually the account that deployed the zero-knowledge asset contract.

The Mint proof will verify the following balancing relationship

> currentTotalValue = newTotalValue + mintedNotesValue

## Burn

The zero-knowledge asset owner can burn unspent Aztec notes using the Burn proof. The is destroying tokens.

The Burn proof accepts four parameters:

- **currentTotalValueNote** previous sum of all burnt notes which will have zero value on the first burn.
- **newTotalValueNote** new sum of all burnt notes. This note must be kept for the next burn proof to work. Constructing another note with the same value and owner will not work as it'll have a different hash.
- **burnedNotes** list of unspent notes to be burnt.
- **sender** the account that will send the `confidentialBurn` transaction to the zero-knowledge asset contract. This must be the zero-knowledge asset contract owner which is usually the account that deployed the zero-knowledge asset contract.

The Burn proof will verify the following balancing relationship

> currentTotalValue = newTotalValue + burnedNotesValue

### Transfer

The Join Split proof can support many input notes with different owners to many output notes with different owners. This makes it much more flexible than a standard ERC20 transfer that can only have one spending account and one recipient account.

The owner of each of the input notes must sign the join split proof for the transfer to be valid.

If the zero-knowledge asset is linked to a public ERC20 token on deployment, a Join Split can be used to transfer ERC20 tokens to unspent Aztec notes. No new value is being created. The public ERC20 token are just converted to shielded tokens using a JoinSplit proof.

The Join Split proof accepts five parameters:

- **inputNotes** unspent notes to be spent
- **outputNotes** new unspent notes to be created
- **sender** the account that will send the `confidentialTransfer` transaction to the zero-knowledge asset contract. This must be any account. It does not have to be the owner of the input notes.
- **publicValue** deposit (negative), withdrawal (positive) or transfer (zero)
- **publicOwner** owner of the linked ERC20 tokens. Only relevant for deposits or withdrawals.

The Join Split proof will verify the following balancing relationship

> inputNotesValue = outputNotesValue + publicValue

### Approve and TransferFrom

A note owner can approve another account to spend their note. There are two ways this can be done:

1. `confidentialApprove` is like an ERC20 approve. The note owner signs a message that grants a spending account the right to spend the specified note a `confidentialTransferFrom` transaction.
2. `approveProof` is a little more generic as it grants a whole proof the right to spend the input notes, which can be many. A `confidentialTransferFrom` transaction is still used to spend the input notes in the proof and construct the unspent output nots.

The spending account that is approved to spend the note(s) can be an externally owned account or a smart contract.

## Anonymizing the participants

In closed systems where there are a limit number of participants, zero value notes can be created for all participants in a transaction to hide which participants received a note of value. This works because zero value notes look no different to notes with value if you are not the note owner or granted viewer access. This anonymization method can be applied to mint, burn and transfer operations.

## Cryptography

Like a lot of Blockchain protocols, Aztec uses many different cryptography schemes. For the zero-knowledge part, is uses a form of special-purpose zero-knowledge proofs leveraging Boneh-Boyen signatures to create a commitment scheme equipped with efficient range proofs. The [Aztec Protocol whitepaper](https://github.com/AztecProtocol/AZTEC/blob/master/AZTEC.pdf) covers the details of the cryptography, but it's not something developers using AZTEC need to understand and is not something covered here.

AZTEC uses the Elliptic Curve Diffie–Hellman (ECDH) key agreement scheme to encrypt the note viewing keys. This uses the [Curve25519](http://en.wikipedia.org/wiki/Curve25519) elliptic curve offering 128 bits of security defined as: y^2=x^3+b. This is different to the [secp256k1](https://en.bitcoin.it/wiki/Secp256k1) elliptic curve used to sign Ethereum transactions.

Ripple's [Curves with a Twist](https://ripple.com/insights/curves-with-a-twist/) blog compares the elliptic secp256k1 and Curve25519 curves.

## Other proofs

So far we have talked about mint, burn and transfers which each have their own Aztec proofs. There are a number of other proofs that can be used with notes in a zero-knowledge asset.

### Dividend Proof

Dividend proofs prove dividend or interest payments are a proportion of a note's value. For example, it can prove a 2.1% interest payment note has the correct value given a nominal input note.

### Private Range Proof

Private range proofs prove a note's value is greater than another note's value. The proof contains a utility note that is the difference between the two comparison notes. The values of the three notes are known at proof construction but are unknown by the verifier.

### Public Range Proof

Public range proofs prove a note's value is greater than or less than a public known value. Like the private range proof, a utility note is required that is the difference between the note and public values. This is important as without the utility note in the proof it would be relatively easy to construct proofs that would narrow down on the note's value using a higher or lower strategy.

### Swap Proof

The swap proof allows the atomic exchange of notes in different zero-knowledge assets. For example, exchange an asset token with a cash token. The proof verifies that no extra value was created without the verifier knowing the values of the notes being exchanged.
