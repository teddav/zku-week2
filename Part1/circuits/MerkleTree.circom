pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

// I used https://github.com/appliedzkp/incrementalquintree for help

template Hasher() {
    signal input leaf1;
    signal input leaf2;
    signal output hash;

    component poseidonHash = Poseidon(2);
    poseidonHash.inputs[0] <== leaf1;
    poseidonHash.inputs[1] <== leaf2;

    hash <== poseidonHash.out;
}

template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    signal input leaves[2**n];
    signal output root;

    //[assignment] insert your code here to calculate the Merkle root from 2^n leaves
    var i;

    var nHashes = 0;
    for (i = 0; i < n; i++) {
        nHashes += 2 ** i;
    }
    component hashes[nHashes];

    
    for (i = 0; i < nHashes; i++) {
        hashes[i] = Hasher();
    }

    for (i = 0; i < 2**(n-1); i++) {
        hashes[i].leaf1 <== leaves[i];
        hashes[i].leaf2 <== leaves[i + 1];
    }

    var k = 0;
    for (i = 2**(n-1); i < nHashes; i++) {
        hashes[i].leaf1 <== hashes[k*2].hash;
        hashes[i].leaf2 <== hashes[k*2 + 1].hash;

        k++;
    }

    root <== hashes[nHashes - 1].hash;
}

template HashLeftRight() {
    signal input left;
    signal input right;

    signal output hash;

    component hasher = Hasher();
    left ==> hasher.leaf1;
    right ==> hasher.leaf2;

    hash <== hasher.hash;
}

template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal

    //[assignment] insert your code here to compute the root from a leaf and elements along the path
    component hashers[n];
    component mux[n];

    signal levelHashes[n + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < n; i++) {
        // Should be 0 or 1
        path_index[i] * (1 - path_index[i]) === 0;

        hashers[i] = HashLeftRight();
        mux[i] = MultiMux1(2);

        mux[i].c[0][0] <== levelHashes[i];
        mux[i].c[0][1] <== path_elements[i];

        mux[i].c[1][0] <== path_elements[i];
        mux[i].c[1][1] <== levelHashes[i];

        mux[i].s <== path_index[i];
        hashers[i].left <== mux[i].out[0];
        hashers[i].right <== mux[i].out[1];

        levelHashes[i + 1] <== hashers[i].hash;
    }

    root <== levelHashes[n];
}