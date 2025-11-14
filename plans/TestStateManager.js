const fs = require('fs');
const path = require('path');

// State management for tracking passed cards across retries
class TestStateManager {
  constructor(testName) {
    this.stateDir = path.join(__dirname, '..', 'test-results', '.test-state');
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
    
    // Create unique state file per test URL
    const sanitizedName = testName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    this.stateFile = path.join(this.stateDir, `state-${sanitizedName}.json`);
    
    // Load existing state or create new
    this.state = this.loadState();
  }
  
  loadState() {
    if (fs.existsSync(this.stateFile)) {
      try {
        const content = fs.readFileSync(this.stateFile, 'utf-8');
        return JSON.parse(content);
      } catch (err) {
        console.log(`⚠️  Could not load state file: ${err.message}`);
      }
    }
    return { passedCards: [], timestamp: new Date().toISOString() };
  }
  
  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.log(`⚠️  Could not save state file: ${err.message}`);
    }
  }
  
  hasCardPassed(tabIndex, cardIndex) {
    const cardKey = `tab${tabIndex}-card${cardIndex}`;
    return this.state.passedCards.includes(cardKey);
  }
  
  markCardPassed(tabIndex, cardIndex) {
    const cardKey = `tab${tabIndex}-card${cardIndex}`;
    if (!this.state.passedCards.includes(cardKey)) {
      this.state.passedCards.push(cardKey);
      this.saveState();
      console.log(`   ✅ Card marked as passed: ${cardKey}`);
    }
  }
  
  clear() {
    if (fs.existsSync(this.stateFile)) {
      fs.unlinkSync(this.stateFile);
    }
  }
  
  getStats() {
    return {
      totalPassed: this.state.passedCards.length,
      timestamp: this.state.timestamp
    };
  }
}

module.exports = TestStateManager;

