/* clyra.js */
(function() {
    const API_URL = 'http://localhost:3000/api/chat';

    // Generate or retrieve Session ID
    let sessionId = localStorage.getItem('clyra_session_id');
    if (!sessionId) {
        sessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        localStorage.setItem('clyra_session_id', sessionId);
    }

    // Inject HTML Structure
    const widgetHTML = `
        <div id="clyra-widget-container">
            <div id="clyra-chat-window">
                <div id="clyra-header">
                    <h3><span class="clyra-status-dot"></span> Clyra Assistant</h3>
                    <button id="clyra-close">&times;</button>
                </div>
                <div id="clyra-messages"></div>
                <div id="clyra-quick-replies">
                    <button class="clyra-quick-btn">Book Appointment</button>
                    <button class="clyra-quick-btn">Check Availability</button>
                    <button class="clyra-quick-btn">Clinic Address</button>
                    <button class="clyra-quick-btn">Talk to Human</button>
                </div>
                <div id="clyra-input-area">
                    <input type="text" id="clyra-input" placeholder="Type your message..." autocomplete="off"/>
                    <button id="clyra-send">
                        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </button>
                </div>
            </div>
            <div id="clyra-fab">
                <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', widgetHTML);

    const fab = document.getElementById('clyra-fab');
    const chatWindow = document.getElementById('clyra-chat-window');
    const closeBtn = document.getElementById('clyra-close');
    const messagesDiv = document.getElementById('clyra-messages');
    const input = document.getElementById('clyra-input');
    const sendBtn = document.getElementById('clyra-send');
    const quickBtns = document.querySelectorAll('.clyra-quick-btn');

    let isOpen = false;
    let historyLoaded = false; // We can load history if we implement a GET endpoint, but since we didn't, we'll start fresh visually if reloaded unless we read it from localstorage. We'll store chat history locally!

    let chatHistory = JSON.parse(localStorage.getItem('clyra_chat_history')) || [];

    // Toggle Chat
    fab.addEventListener('click', () => {
        isOpen = !isOpen;
        if (isOpen) {
            chatWindow.classList.add('open');
            fab.style.transform = 'scale(0)';
            if (!historyLoaded) {
                renderHistory();
                historyLoaded = true;
            }
        } else {
            chatWindow.classList.remove('open');
            fab.style.transform = 'scale(1)';
        }
    });

    closeBtn.addEventListener('click', () => {
        isOpen = false;
        chatWindow.classList.remove('open');
        fab.style.transform = 'scale(1)';
    });

    function appendMessage(text, sender, save = true) {
        const msgDiv = document.createElement('div');
        msgDiv.className = \`clyra-msg \${sender}\`;
        // Basic markdown/newline handle
        msgDiv.innerHTML = text.replace(/\\n/g, '<br/>').replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
        messagesDiv.appendChild(msgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        if (save) {
            chatHistory.push({ text, sender });
            localStorage.setItem('clyra_chat_history', JSON.stringify(chatHistory));
        }
    }

    function showTyping() {
        const typeDiv = document.createElement('div');
        typeDiv.className = 'clyra-typing';
        typeDiv.id = 'clyra-typing-indicator';
        typeDiv.innerHTML = '<div class="clyra-dot"></div><div class="clyra-dot"></div><div class="clyra-dot"></div>';
        messagesDiv.appendChild(typeDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function hideTyping() {
        const typeDiv = document.getElementById('clyra-typing-indicator');
        if (typeDiv) typeDiv.remove();
    }

    function renderHistory() {
        if (chatHistory.length === 0) {
            appendMessage("Hello! I'm Clyra, the AI Assistant for San Jose Dental Clinic. How can I help you smile brighter today? 😁", "bot", false);
        } else {
            chatHistory.forEach(m => appendMessage(m.text, m.sender, false));
        }
    }

    async function sendMessage(text) {
        if (!text.trim()) return;
        
        appendMessage(text, "user");
        input.value = '';
        showTyping();

        try {
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, message: text })
            });
            const data = await res.json();
            hideTyping();
            if (data.reply) {
                appendMessage(data.reply, "bot");
            } else {
                appendMessage("Oops, I encountered a tiny error. Let's try again.", "bot");
            }
        } catch (error) {
            console.error(error);
            hideTyping();
            appendMessage("Sorry, I'm having trouble connecting to the clinic. Please call us at (213) 483-8222.", "bot");
        }
    }

    sendBtn.addEventListener('click', () => sendMessage(input.value));
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage(input.value);
    });

    quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sendMessage(btn.textContent);
        });
    });

})();
