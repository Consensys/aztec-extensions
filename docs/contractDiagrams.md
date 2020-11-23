# UML Diagrams of the Aztec contracts

## AZTEC Cryptography Engine (ACE)

![ACE](./ACE.svg)

```
sol2uml --baseContractNames ACE -o ./docs/ACE.svg
```

## Zero-Knowledge Asset Linked

![zkAssetLinked](./zkAssetLinked.svg)

```
sol2uml --baseContractNames ZkAsset -o ./docs/zkAssetLinked.svg
```

## Zero-Knowledge Asset Direct

![zkAssetDirect](./zkAssetDirect.svg)

```
sol2uml ./scr/chain/contracts --baseContractNames ZkAssetDirect -o ./docs/zkAssetDirect.svg
```

## Zero-Knowledge Asset Holdable

![zkAssetMintable](./zkAssetHoldable.svg)

```
sol2uml --baseContractNames ZkAssetHoldable -o ./docs/zkAssetHoldable.svg
```
