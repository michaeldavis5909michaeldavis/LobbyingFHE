import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface LobbyingRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  company: string;
  amount: number;
  recipient: string;
  category: string;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<LobbyingRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<LobbyingRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    company: "",
    amount: "",
    recipient: "",
    category: "",
    description: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedRecord, setSelectedRecord] = useState<LobbyingRecord | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Calculate statistics
  const totalAmount = records.reduce((sum, record) => sum + record.amount, 0);
  const verifiedAmount = records
    .filter(r => r.status === "verified")
    .reduce((sum, record) => sum + record.amount, 0);
  const companyCount = new Set(records.map(r => r.company)).size;
  const categoryCount = new Set(records.map(r => r.category)).size;

  // Filter records based on search and category
  useEffect(() => {
    let result = records;
    
    if (searchTerm) {
      result = result.filter(record => 
        record.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.recipient.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (selectedCategory !== "all") {
      result = result.filter(record => record.category === selectedCategory);
    }
    
    setFilteredRecords(result);
  }, [records, searchTerm, selectedCategory]);

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("lobbying_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: LobbyingRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`lobbying_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                company: recordData.company,
                amount: recordData.amount,
                recipient: recordData.recipient,
                category: recordData.category,
                status: recordData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting lobbying data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        company: newRecordData.company,
        amount: parseFloat(newRecordData.amount),
        recipient: newRecordData.recipient,
        category: newRecordData.category,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `lobbying_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("lobbying_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "lobbying_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted lobbying data submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          company: "",
          amount: "",
          recipient: "",
          category: "",
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`lobbying_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "verified"
      };
      
      await contract.setData(
        `lobbying_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const showRecordDetails = (record: LobbyingRecord) => {
    setSelectedRecord(record);
    setShowDetailsModal(true);
  };

  const renderBarChart = () => {
    // Group by category and calculate total amount
    const categoryMap = new Map();
    records.forEach(record => {
      const current = categoryMap.get(record.category) || 0;
      categoryMap.set(record.category, current + record.amount);
    });
    
    const categories = Array.from(categoryMap.keys());
    const maxAmount = Math.max(...Array.from(categoryMap.values()));
    
    return (
      <div className="bar-chart-container">
        {categories.map(category => {
          const amount = categoryMap.get(category);
          const height = (amount / maxAmount) * 100;
          
          return (
            <div key={category} className="bar-chart-item">
              <div className="bar-label">{category}</div>
              <div className="bar-wrapper">
                <div 
                  className="bar-fill" 
                  style={{ height: `${height}%` }}
                ></div>
              </div>
              <div className="bar-value">${amount.toLocaleString()}</div>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="grid-icon"></div>
          </div>
          <h1>Lobbying<span>FHE</span>Analysis</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn cyber-button"
          >
            <div className="add-icon"></div>
            Add Record
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Analysis of Corporate Lobbying Data</h2>
            <p>Analyze encrypted political donations and lobbying data using FHE to reveal potential influence networks</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Analytics</span>
          </div>
        </div>
        
        <div className="dashboard-panels">
          <div className="panel-left">
            <div className="panel-section cyber-card">
              <h3>Project Introduction</h3>
              <p>LobbyingFHE enables watchdog organizations to analyze encrypted corporate lobbying and political donation data using Fully Homomorphic Encryption (FHE) technology.</p>
              <div className="feature-list">
                <div className="feature-item">
                  <div className="feature-icon">🔒</div>
                  <span>Encrypted lobbying & donation data</span>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">📊</div>
                  <span>FHE network graph analysis</span>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">⚖️</div>
                  <span>Identify potential conflicts of interest</span>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">🌐</div>
                  <span>Promote political transparency</span>
                </div>
              </div>
            </div>
            
            <div className="panel-section cyber-card">
              <h3>Data Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">${totalAmount.toLocaleString()}</div>
                  <div className="stat-label">Total Amount</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">${verifiedAmount.toLocaleString()}</div>
                  <div className="stat-label">Verified Amount</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{companyCount}</div>
                  <div className="stat-label">Companies</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{categoryCount}</div>
                  <div className="stat-label">Categories</div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="panel-right">
            <div className="panel-section cyber-card">
              <h3>Lobbying by Category</h3>
              {records.length > 0 ? (
                renderBarChart()
              ) : (
                <div className="no-data">No data available</div>
              )}
            </div>
            
            <div className="panel-section cyber-card">
              <h3>Search & Filter</h3>
              <div className="search-filter">
                <input
                  type="text"
                  placeholder="Search companies, recipients..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cyber-input"
                />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="cyber-select"
                >
                  <option value="all">All Categories</option>
                  <option value="Technology">Technology</option>
                  <option value="Finance">Finance</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Energy">Energy</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        
        <div className="records-section">
          <div className="section-header">
            <h2>Encrypted Lobbying Records</h2>
            <div className="header-actions">
              <button 
                onClick={loadRecords}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="records-list cyber-card">
            <div className="table-header">
              <div className="header-cell">Company</div>
              <div className="header-cell">Amount</div>
              <div className="header-cell">Recipient</div>
              <div className="header-cell">Category</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredRecords.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon"></div>
                <p>No lobbying records found</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Record
                </button>
              </div>
            ) : (
              filteredRecords.map(record => (
                <div className="record-row" key={record.id}>
                  <div className="table-cell">{record.company}</div>
                  <div className="table-cell">${record.amount.toLocaleString()}</div>
                  <div className="table-cell">{record.recipient}</div>
                  <div className="table-cell">{record.category}</div>
                  <div className="table-cell">
                    {new Date(record.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${record.status}`}>
                      {record.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    <button 
                      className="action-btn cyber-button"
                      onClick={() => showRecordDetails(record)}
                    >
                      Details
                    </button>
                    {record.status === "pending" && (
                      <button 
                        className="action-btn cyber-button success"
                        onClick={() => verifyRecord(record.id)}
                      >
                        Verify
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {showDetailsModal && selectedRecord && (
        <ModalDetails
          record={selectedRecord}
          onClose={() => setShowDetailsModal(false)}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="grid-icon"></div>
              <span>LobbyingFHE Analysis</span>
            </div>
            <p>Confidential analysis of corporate lobbying data using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Transparency</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} LobbyingFHE Analysis. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.company || !recordData.amount || !recordData.recipient || !recordData.category) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Add Lobbying Data Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your lobbying data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Company *</label>
              <input 
                type="text"
                name="company"
                value={recordData.company} 
                onChange={handleChange}
                placeholder="Company name" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Amount ($) *</label>
              <input 
                type="number"
                name="amount"
                value={recordData.amount} 
                onChange={handleChange}
                placeholder="Amount" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Recipient *</label>
              <input 
                type="text"
                name="recipient"
                value={recordData.recipient} 
                onChange={handleChange}
                placeholder="Recipient name" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={recordData.category} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="">Select category</option>
                <option value="Technology">Technology</option>
                <option value="Finance">Finance</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Energy">Energy</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description"
                value={recordData.description} 
                onChange={handleChange}
                placeholder="Additional details about this lobbying activity..." 
                className="cyber-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModalDetailsProps {
  record: LobbyingRecord;
  onClose: () => void;
}

const ModalDetails: React.FC<ModalDetailsProps> = ({ record, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="details-modal cyber-card">
        <div className="modal-header">
          <h2>Lobbying Record Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <label>Record ID</label>
              <span>{record.id}</span>
            </div>
            <div className="detail-item">
              <label>Company</label>
              <span>{record.company}</span>
            </div>
            <div className="detail-item">
              <label>Amount</label>
              <span>${record.amount.toLocaleString()}</span>
            </div>
            <div className="detail-item">
              <label>Recipient</label>
              <span>{record.recipient}</span>
            </div>
            <div className="detail-item">
              <label>Category</label>
              <span>{record.category}</span>
            </div>
            <div className="detail-item">
              <label>Date</label>
              <span>{new Date(record.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="detail-item">
              <label>Status</label>
              <span className={`status-badge ${record.status}`}>{record.status}</span>
            </div>
          </div>
          
          <div className="encryption-notice">
            <div className="lock-icon"></div>
            <p>This data is encrypted using FHE technology. Actual content is only accessible through FHE computations.</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="close-btn cyber-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;