import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';



dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prisma = new PrismaClient();
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});
const CLINIC_ADDRESS = '2161 W 6th St, Los Angeles, CA 90057';
const CLINIC_CONTACT = '(213) 483-8222';
const AVAILABLE_SLOTS_ALL = ['10:00 AM', '11:30 AM', '2:00 PM', '5:00 PM'];

// Helper to interact with Gemini
async function askClyra(systemInstruction, userMessage) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash', // use current gemini model
            contents: userMessage,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.2
            }
        });
        return response.text;
    } catch (err) {
        console.error('Gemini API Error:', err);
        return "Maaf karna, something went wrong on my end! Please try again.";
    }
}

// Ensure proper model name
const GEMINI_MODEL = 'gemini-2.5-flash';

async function generateAIResponse(prompt, systemMsg) {
    try {
        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
                systemInstruction: systemMsg,
                temperature: 0.3
            }
        });
        return response.text.trim();
    } catch (e) {
        console.error(e);
        // Fallback in case the model is incorrect for this SDK version
        try {
            const response2 = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: prompt,
                config: { systemInstruction: systemMsg, temperature: 0.3 }
            });
            return response2.text.trim();
        } catch (e2) {
            return "I'm having connection issues. Please try again.";
        }
    }
}

// State Machine Handlers
async function processChatMessage(sessionId, message) {
    // Try finding session
    let session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
        session = await prisma.session.create({ data: { id: sessionId } });
    }

    // Get chat history for context (optional, but good)
    const recentLogs = await prisma.chatLog.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        take: 5
    });

    let nextState = session.state;
    let botReply = '';

    const systemPromptGeneral = `You are Clyra, AI Clinic Assistant for San Jose Dental Clinic.
Tone: Polite, short, clear, uses Hinglish and simple English with moderate emojis.
Constraint: STRICTLY NEVER give medical advice. If asked for medical advice, reply EXACTLY: "Please consult the doctor directly for accurate advice".
Clinic Address: ${CLINIC_ADDRESS}. Clinic Contact: ${CLINIC_CONTACT}.
Current User Message: "${message}"`;

    if (session.state === 'INIT') {
        // If user clicked quick replies
        if (message.toLowerCase() === 'book appointment') {
            nextState = 'AWAITING_DOCTOR';
            botReply = "Great! Let's get your appointment booked. 🦷 Who would you like to see? Dr. Sharma (10 AM–2 PM) or Dr. Mehta (4 PM–8 PM)?";
        } else if (message.toLowerCase() === 'check availability') {
            botReply = "Our general available slots are 10:00 AM, 11:30 AM, 2:00 PM, and 5:00 PM. Would you like to 'Book Appointment'?";
        } else if (message.toLowerCase() === 'clinic address') {
            botReply = `Humara clinic idhar hai: ${CLINIC_ADDRESS}. Contact number is ${CLINIC_CONTACT}.`;
        } else if (message.toLowerCase() === 'talk to human') {
            botReply = `You can call us directly at ${CLINIC_CONTACT} during clinic hours to speak with our human staff. 📞`;
        } else {
            // Use LLM for general chitchat or detect intent to book
            const extractIntent = await generateAIResponse(
                `Analyze this user message: "${message}". Does the user want to book an appointment? Reply only "YES" or "NO".`,
                "You are an intent extractor."
            );
            if (extractIntent.includes("YES")) {
                nextState = 'AWAITING_DOCTOR';
                botReply = "Great! Let's book your appointment. Who would you like to see? Dr. Sharma (10 AM–2 PM) or Dr. Mehta (4 PM–8 PM)? 🩺";
            } else {
                botReply = await generateAIResponse(message, systemPromptGeneral);
            }
        }
    }
    else if (session.state === 'AWAITING_DOCTOR') {
        const msg = message.toLowerCase();
        if (msg.includes('sharma') || msg.includes('10') || msg.includes('2')) {
            await prisma.session.update({ where: { id: sessionId }, data: { doctor: 'Dr. Sharma' } });
            nextState = 'AWAITING_DATE';
            botReply = "Awesome, Dr. Sharma it is. 📅 What date would you like? (e.g., Today, Tomorrow, or a specific date like 25 Dec)";
        } else if (msg.includes('mehta') || msg.includes('4') || msg.includes('8')) {
            await prisma.session.update({ where: { id: sessionId }, data: { doctor: 'Dr. Mehta' } });
            nextState = 'AWAITING_DATE';
            botReply = "Awesome, Dr. Mehta it is. 📅 What date would you like? (e.g., Today, Tomorrow, or a specific date like 25 Dec)";
        } else {
            botReply = "Please select either Dr. Sharma or Dr. Mehta. Aap kis doctor ko dikhana chahte hain?";
        }
    }
    else if (session.state === 'AWAITING_DATE') {
        // Just accept whatever date string they give for simplicity, or we can format it.
        await prisma.session.update({ where: { id: sessionId }, data: { date: message } });

        // Slot validation
        const takenSlots = await prisma.appointment.findMany({
            where: { doctor: session.doctor, date: message },
            select: { time: true }
        });
        const takenTimeStrings = takenSlots.map(a => a.time);
        const available = AVAILABLE_SLOTS_ALL.filter(s => !takenTimeStrings.includes(s));

        if (available.length === 0) {
            botReply = `Oh no! 😔 All slots are fully booked for ${message} with ${session.doctor}. Please provide another date.`;
            nextState = 'AWAITING_DATE';
        } else {
            nextState = 'AWAITING_TIME';
            botReply = `Perfect! Here are the available slots for ${message}: ${available.join(', ')}. What time works best for you? ⏰`;
        }
    }
    else if (session.state === 'AWAITING_TIME') {
        // Validate selected time
        const timeVal = message.toUpperCase();
        let matchedTime = null;
        AVAILABLE_SLOTS_ALL.forEach(t => { if (timeVal.includes(t)) matchedTime = t; });

        if (!matchedTime) {
            // If no direct match, check if they typed just "10" or "2"
            if (timeVal.includes('10')) matchedTime = '10:00 AM';
            else if (timeVal.includes('11') || timeVal.includes('11:30')) matchedTime = '11:30 AM';
            else if (timeVal.includes('2')) matchedTime = '2:00 PM';
            else if (timeVal.includes('5')) matchedTime = '5:00 PM';
        }

        if (matchedTime) {
            // Double check availability
            const checkSlot = await prisma.appointment.findFirst({
                where: { doctor: session.doctor, date: session.date, time: matchedTime }
            });
            if (checkSlot) {
                botReply = `Sorry, ${matchedTime} just got booked! 😕 Could you pick another time?`;
            } else {
                await prisma.session.update({ where: { id: sessionId }, data: { time: matchedTime } });
                nextState = 'AWAITING_DETAILS';
                botReply = `Great! ${matchedTime} is reserved for you. Finally, please provide your **Name**, **Age**, and optionally your **Problem** so I can finalize the booking. 📝`;
            }
        } else {
            botReply = "Please pick one of the available times (e.g. 10:00 AM).";
        }
    }
    else if (session.state === 'AWAITING_DETAILS') {
        // Use LLM to extract Name, Age, Problem
        const prompt = `Extract Patient Name, Age (number), and Problem from this message: "${message}".
      Return ONLY a JSON object with keys: "name", "age", "problem". 
      If age is missing, "age" should be null. If problem missing, "problem" should be null.`;

        const extraction = await generateAIResponse(prompt, "You are a rigid data extractor returning raw valid JSON.");
        try {
            const cleanJsonStr = extraction.replace(/```json/g, '').replace(/```/g, '').trim();
            const pData = JSON.parse(cleanJsonStr);

            if (!pData.name || !pData.age) {
                botReply = "Aapka naam aur umar jaruri hai (Name and Age are required). Could you please provide them clearly?";
                nextState = 'AWAITING_DETAILS';
            } else {
                // Final confirmation and DB insertion
                const finalSession = await prisma.session.update({
                    where: { id: sessionId },
                    data: {
                        state: 'CONFIRMED',
                        name: String(pData.name),
                        age: Number(pData.age),
                        problem: pData.problem ? String(pData.problem) : null
                    }
                });

                await prisma.appointment.create({
                    data: {
                        name: finalSession.name,
                        age: finalSession.age,
                        doctor: finalSession.doctor,
                        date: finalSession.date,
                        time: finalSession.time,
                        problem: finalSession.problem
                    }
                });

                nextState = 'CONFIRMED';
                botReply = `✅ Appointment Confirmed!
Name: ${finalSession.name}
Age: ${finalSession.age}
Doctor: ${finalSession.doctor}
Date: ${finalSession.date}
Time: ${finalSession.time}
Problem: ${finalSession.problem || 'None provided'}

Thank you for booking with San Jose Dental Clinic! See you soon. 🥰`;
            }
        } catch (e) {
            console.error("Extraction error:", e, extraction);
            botReply = "I couldn't quite catch your Name and Age. Please type exactly like: 'My name is Rahul, 25 years old'.";
        }
    }
    else if (session.state === 'CONFIRMED') {
        botReply = "Your appointment is already confirmed! If you need to book another one, just type 'Book Appointment' or say 'Start over'.";
        if (message.toLowerCase().includes('book') || message.toLowerCase().includes('start')) {
            nextState = 'INIT';
            botReply = "Okay, let's start fresh. Who would you like to see? Dr. Sharma (10 AM–2 PM) or Dr. Mehta (4 PM–8 PM)?";
            nextState = 'AWAITING_DOCTOR';
        }
    }

    // Update State if changed
    if (nextState !== session.state) {
        await prisma.session.update({ where: { id: sessionId }, data: { state: nextState } });
    }

    // Save chat log
    await prisma.chatLog.create({
        data: {
            sessionId,
            userMessage: message,
            botResponse: botReply
        }
    });

    return { reply: botReply, state: nextState };
}

app.post('/api/chat', async (req, res) => {
    try {
        const { sessionId, message } = req.body;
        if (!sessionId || !message) {
            return res.status(400).json({ error: 'sessionId and message are required' });
        }

        // Medical Advice Override check
        const medicalCheckPrompt = `Does this message seem like the user is asking for medical advice, diagnoses, or prescriptions?
        Message: "${message}"
        Reply only YES or NO.`;
        const isMedical = await generateAIResponse(medicalCheckPrompt, "You are a medical intent detector.");
        if (isMedical.includes("YES")) {
            return res.json({
                reply: "Please consult the doctor directly for accurate advice. 🌸",
                state: null
            });
        }

        const responseData = await processChatMessage(sessionId, message);
        res.json(responseData);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Clyra Backend running on port ${PORT}`);
});
