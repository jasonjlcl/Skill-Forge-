# Skill Forge: GenAI-Powered Onboarding Platform

**Group 3 – TIE3100 Systems Design Project**  
**Team Members:** Syafiq, Desiree, Jason Lim, Bushra, Gerard, Afiq

---

## 📖 Project Overview
Skill Forge addresses the evolving need for workforce transformation in manufacturing SMEs by delivering a GenAI-driven, personalized onboarding experience. Built as part of our A-grade Systems Design project, Skill Forge benchmarks Generative AI against traditional methods to empower Industry 5.0 objectives.
https://lms.fiqfordini.com/auth
---

## 🌐 Background & Problem Statement
- **Background:**  
  Traditional onboarding in SMEs relies on printed materials and human-led briefings, leading to high training time, limited scalability, and inconsistent outcomes.  
- **Key Challenges:**  
  - Lack of structured validation frameworks  
  - Low AI literacy and cultural skepticism  
  - High setup cost, unclear ROI, and risk of downtime in safety-critical environments  

---

## 🧭 Methodology  
We followed an internal sprint project using the PDCA cycle:

1. **Research:** Literature review to identify gaps in GenAI adoption (frameworks, trust, scalability, training)  
2. **Design:** Compare traditional vs. GenAI approaches; define UI/UX and system architecture  
3. **Build:** Develop React SPA frontend, Node.js API, ChromaDB vector store, and integrate Gemini Flash LLM  
4. **Evaluate:** Pilot with 30 participants; measure training time, satisfaction, confidence, and retention  

---

## 🔍 Literature Review  
**Key Themes Extracted:**  
- Lack of structured GenAI frameworks in manufacturing  
- Trust & explainability issues  
- Scalability & cost barriers for SMEs  
- Workforce training and AI-human collaboration gaps  

Our automated review pipeline ingested 50K+ OpenAlex records, filtered to 17K abstracts, resolved DOIs, and extracted 23 fields via Gemini 1.5, reducing processing from days to hours.

---

## 🚀 Developing Skill Forge
- **Frontend:** React SPA with clean, human-centric interface for factory workers  
- **Backend:** Node.js API, JWT authentication, SSE chat assistant  
- **Data Store:** ChromaDB vector database for semantic retrieval  
- **AI Engine:** Google Gemini Flash LLM for interactive tutoring and quiz generation  

**Core Features:**  
- Real-time contextual assistance  
- Adaptive quizzes with explainable outputs  
- Time-on-task analytics and performance dashboards  

---

## 📊 Pilot Results & Comparison
| Metric              | Traditional Onboarding | Skill Forge (GenAI)  |
|---------------------|------------------------|----------------------|
| Training Time       | 60 min                 | 35 min (−42%)        |
| User Confidence     | 3.2 / 5                | 4.6 / 5              |
| Satisfaction        | 3.5 / 5                | 4.8 / 5 (+37%)       |
| Knowledge Retention | 68%                    | 88% (+29%)           |

Participants reported higher autonomy, reduced cognitive friction, and positive feedback on explainability and multilingual support.

---

## 💡 Recommendations & Go-to-Market
- Target SMEs with tiered pricing and a lead-generation landing page  
- Emphasize Industry 5.0 alignment: human empowerment through explainable AI  
- Offer on-premise LLM fallback for data-sensitive deployments  

---

## 🎯 Conclusion
Skill Forge demonstrates that scalable, personalized GenAI onboarding is essential for manufacturing’s future. By bridging the gap between traditional training and AI-driven efficiency, it enhances workforce readiness and drives real impact in SME contexts.

---

## 📂 Data & License
- **Code:** MIT License (see [LICENSE](LICENSE))  
- **Data:** Derived outputs licensed CC BY 4.0 (cite Lim et al., 2025)

---
