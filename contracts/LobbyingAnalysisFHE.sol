// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LobbyingAnalysisFHE is SepoliaConfig {
    struct EncryptedDonation {
        uint256 id;
        euint32 encryptedAmount;      // Encrypted donation amount
        euint32 encryptedEntity;     // Encrypted recipient entity ID
        euint32 encryptedDonor;      // Encrypted donor company ID
        uint256 timestamp;
    }
    
    struct DecryptedDonation {
        uint32 amount;
        string entity;
        string donor;
        bool isRevealed;
    }

    struct EncryptedConnection {
        euint32 entity1;
        euint32 entity2;
        euint32 weight;
    }

    uint256 public donationCount;
    mapping(uint256 => EncryptedDonation) public encryptedDonations;
    mapping(uint256 => DecryptedDonation) public decryptedDonations;
    
    mapping(string => euint32) private encryptedEntityTotals;
    mapping(string => euint32) private encryptedDonorTotals;
    string[] private entityList;
    string[] private donorList;
    
    EncryptedConnection[] private encryptedConnections;
    
    mapping(uint256 => uint256) private requestToDonationId;
    
    event DonationRecorded(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event DonationDecrypted(uint256 indexed id);
    event ConnectionAnalyzed(uint256 indexed connectionId);
    
    modifier onlyAuthorized() {
        // Add proper authorization logic in production
        _;
    }
    
    function recordEncryptedDonation(
        euint32 encryptedAmount,
        euint32 encryptedEntity,
        euint32 encryptedDonor
    ) public onlyAuthorized {
        donationCount += 1;
        uint256 newId = donationCount;
        
        encryptedDonations[newId] = EncryptedDonation({
            id: newId,
            encryptedAmount: encryptedAmount,
            encryptedEntity: encryptedEntity,
            encryptedDonor: encryptedDonor,
            timestamp: block.timestamp
        });
        
        decryptedDonations[newId] = DecryptedDonation({
            amount: 0,
            entity: "",
            donor: "",
            isRevealed: false
        });
        
        emit DonationRecorded(newId, block.timestamp);
    }
    
    function requestDonationDecryption(uint256 donationId) public onlyAuthorized {
        EncryptedDonation storage donation = encryptedDonations[donationId];
        require(!decryptedDonations[donationId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(donation.encryptedAmount);
        ciphertexts[1] = FHE.toBytes32(donation.encryptedEntity);
        ciphertexts[2] = FHE.toBytes32(donation.encryptedDonor);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptDonation.selector);
        requestToDonationId[reqId] = donationId;
        
        emit DecryptionRequested(donationId);
    }
    
    function decryptDonation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 donationId = requestToDonationId[requestId];
        require(donationId != 0, "Invalid request");
        
        EncryptedDonation storage eDonation = encryptedDonations[donationId];
        DecryptedDonation storage dDonation = decryptedDonations[donationId];
        require(!dDonation.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 amount, string memory entity, string memory donor) = abi.decode(cleartexts, (uint32, string, string));
        
        dDonation.amount = amount;
        dDonation.entity = entity;
        dDonation.donor = donor;
        dDonation.isRevealed = true;
        
        updateEntityTotal(entity, amount);
        updateDonorTotal(donor, amount);
        
        emit DonationDecrypted(donationId);
    }
    
    function analyzeEncryptedConnection(
        euint32 entity1,
        euint32 entity2,
        euint32 weight
    ) public onlyAuthorized {
        encryptedConnections.push(EncryptedConnection({
            entity1: entity1,
            entity2: entity2,
            weight: weight
        }));
        
        emit ConnectionAnalyzed(encryptedConnections.length - 1);
    }
    
    function getDecryptedDonation(uint256 donationId) public view returns (
        uint32 amount,
        string memory entity,
        string memory donor,
        bool isRevealed
    ) {
        DecryptedDonation storage d = decryptedDonations[donationId];
        return (d.amount, d.entity, d.donor, d.isRevealed);
    }
    
    function getEncryptedEntityTotal(string memory entity) public view returns (euint32) {
        return encryptedEntityTotals[entity];
    }
    
    function getEncryptedDonorTotal(string memory donor) public view returns (euint32) {
        return encryptedDonorTotals[donor];
    }
    
    function requestEntityTotalDecryption(string memory entity) public onlyAuthorized {
        euint32 total = encryptedEntityTotals[entity];
        require(FHE.isInitialized(total), "Entity not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(total);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptEntityTotal.selector);
        requestToDonationId[reqId] = stringToHash(entity);
    }
    
    function decryptEntityTotal(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 entityHash = requestToDonationId[requestId];
        string memory entity = getEntityFromHash(entityHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 total = abi.decode(cleartexts, (uint32));
        // Process decrypted total as needed
    }
    
    function updateEntityTotal(string memory entity, uint32 amount) private {
        if (!FHE.isInitialized(encryptedEntityTotals[entity])) {
            encryptedEntityTotals[entity] = FHE.asEuint32(0);
            entityList.push(entity);
        }
        encryptedEntityTotals[entity] = FHE.add(
            encryptedEntityTotals[entity], 
            FHE.asEuint32(amount)
        );
    }
    
    function updateDonorTotal(string memory donor, uint32 amount) private {
        if (!FHE.isInitialized(encryptedDonorTotals[donor])) {
            encryptedDonorTotals[donor] = FHE.asEuint32(0);
            donorList.push(donor);
        }
        encryptedDonorTotals[donor] = FHE.add(
            encryptedDonorTotals[donor], 
            FHE.asEuint32(amount)
        );
    }
    
    function stringToHash(string memory s) private pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(s)));
    }
    
    function getEntityFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < entityList.length; i++) {
            if (stringToHash(entityList[i]) == hash) {
                return entityList[i];
            }
        }
        revert("Entity not found");
    }
}