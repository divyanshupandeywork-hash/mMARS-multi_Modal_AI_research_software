import streamlit as st
import os
import io
import logging
import tempfile
import sqlite3
import zipfile
import rarfile
import markdown
import cv2
import numpy as np
import pytesseract
import speech_recognition as sr
import pandas as pd
from PyPDF2 import PdfReader
from pptx import Presentation
import docx
import xlrd
from bs4 import BeautifulSoup
import spacy
from datetime import datetime

# LangChain / Google GenAI imports
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_ollama import OllamaEmbeddings, ChatOllama
from langchain_community.vectorstores import FAISS
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_classic.chains import ConversationalRetrievalChain
from langchain_classic.memory import ConversationBufferMemory

# Create a logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load local API key if exists
try:
    from config import GOOGLE_API_KEY
except ImportError:
    GOOGLE_API_KEY = ""

# Try loading spaCy model
try:
    nlp = spacy.load("en_core_web_sm")
except Exception as e:
    logger.warning(f"SpaCy model could not be loaded: {e}")
    nlp = None

# Custom CSS for Premium Design
def apply_premium_styles():
    st.markdown("""
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Inter:wght@300;400;600&display=swap');
        
        /* Font rules */
        html, body, [class*="css"] {
            font-family: 'Inter', sans-serif;
        }
        
        h1, h2, h3, .gradient-text {
            font-family: 'Outfit', sans-serif;
            font-weight: 800;
            background: linear-gradient(135deg, #FF4B4B 0%, #FF8F8F 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }
        
        /* Glassmorphism containers */
        .glass-card {
            background: rgba(255, 255, 255, 0.03);
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 24px;
            margin-bottom: 24px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
        }
        
        /* Format tag badges */
        .format-tag {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            background: rgba(255, 75, 75, 0.08);
            color: #FF4B4B;
            border: 1px solid rgba(255, 75, 75, 0.15);
            font-size: 12px;
            margin: 5px;
            font-weight: 600;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .format-tag:hover {
            background: rgba(255, 75, 75, 0.18);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(255, 75, 75, 0.15);
        }
        
        /* Sidebar styling */
        section[data-testid="stSidebar"] {
            background-color: #0E1117;
            border-right: 1px solid #1E293B;
        }
        
        /* Custom buttons */
        .stButton>button {
            background: linear-gradient(135deg, #FF4B4B 0%, #FF2B2B 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            padding: 10px 20px;
            transition: all 0.3s ease;
        }
        
        .stButton>button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(255, 75, 75, 0.4);
        }
        
        /* Chat bubble styles */
        .chat-bubble {
            padding: 14px 18px;
            border-radius: 12px;
            margin-bottom: 12px;
            line-height: 1.5;
            font-size: 14px;
        }
        
        .chat-bubble-user {
            background-color: rgba(255, 75, 75, 0.1);
            border-left: 4px solid #FF4B4B;
            align-self: flex-end;
        }
        
        .chat-bubble-ai {
            background-color: rgba(255, 255, 255, 0.05);
            border-left: 4px solid #4F46E5;
            align-self: flex-start;
        }
    </style>
    """, unsafe_allow_html=True)

# Helper function to log file processing errors
def handle_file_processing_error(file_type: str, error: Exception):
    st.error(f"Error processing {file_type} file: {error}")
    logger.exception(f"Error processing {file_type} file", exc_info=True)

# Text extraction functions
def extract_text_from_pdf(pdf_file):
    text = ""
    try:
        reader = PdfReader(pdf_file)
        for page in reader.pages:
            content = page.extract_text()
            if content:
                text += content + "\n"
    except Exception as e:
        handle_file_processing_error("pdf", e)
    return text

def extract_text_from_ppt(ppt_file):
    text = ""
    try:
        presentation = Presentation(ppt_file)
        for slide in presentation.slides:
            for shape in slide.shapes:
                if hasattr(shape, "text") and shape.text:
                    text += shape.text + "\n"
    except Exception as e:
        handle_file_processing_error("pptx", e)
    return text

def extract_text_from_docx(docx_file):
    text = ""
    try:
        doc = docx.Document(docx_file)
        for para in doc.paragraphs:
            if para.text:
                text += para.text + "\n"
    except Exception as e:
        handle_file_processing_error("docx", e)
    return text

def extract_text_from_excel(excel_file):
    text = ""
    try:
        # Load sheets using pandas
        xls = pd.ExcelFile(excel_file)
        for sheet_name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet_name)
            text += f"--- Sheet: {sheet_name} ---\n"
            text += df.to_string() + "\n\n"
    except Exception as e:
        handle_file_processing_error("excel", e)
    return text

def extract_text_from_csv(csv_file):
    try:
        df = pd.read_csv(csv_file)
        return df.to_string()
    except Exception as e:
        handle_file_processing_error("csv", e)
        return ""

def extract_text_from_html(html_file):
    try:
        soup = BeautifulSoup(html_file.read(), "html.parser")
        return soup.get_text()
    except Exception as e:
        handle_file_processing_error("html", e)
        return ""

def extract_text_from_txt(txt_file):
    try:
        return txt_file.read().decode("utf-8", errors="ignore")
    except Exception as e:
        handle_file_processing_error("txt", e)
        return ""

def extract_text_from_image(image_file):
    try:
        image = cv2.imdecode(np.frombuffer(image_file.read(), np.uint8), cv2.IMREAD_COLOR)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return pytesseract.image_to_string(gray)
    except Exception as e:
        handle_file_processing_error("image", e)
        return ""

def extract_text_from_xml(xml_file):
    try:
        soup = BeautifulSoup(xml_file.read(), "xml")
        return soup.get_text()
    except Exception as e:
        handle_file_processing_error("xml", e)
        return ""

def extract_text_from_md(md_file):
    try:
        return md_file.read().decode("utf-8", errors="ignore")
    except Exception as e:
        handle_file_processing_error("markdown", e)
        return ""

def extract_text_from_zip(zip_file):
    text = ""
    try:
        with zipfile.ZipFile(zip_file) as z:
            for filename in z.namelist():
                if filename.endswith('/'):
                    continue
                with z.open(filename) as f:
                    ext = filename.split('.')[-1].lower()
                    if ext in ['txt', 'csv', 'py', 'js', 'html', 'css', 'json', 'xml', 'md', 'java', 'c', 'cpp', 'rs']:
                        text += f"\n--- File: {filename} ---\n"
                        text += f.read().decode("utf-8", errors="ignore") + "\n"
    except Exception as e:
        handle_file_processing_error("zip", e)
    return text

def extract_text_from_rar(rar_file):
    text = ""
    try:
        with rarfile.RarFile(rar_file) as r:
            for filename in r.namelist():
                if filename.endswith('/'):
                    continue
                with r.open(filename) as f:
                    ext = filename.split('.')[-1].lower()
                    if ext in ['txt', 'csv', 'py', 'js', 'html', 'css', 'json', 'xml', 'md', 'java', 'c', 'cpp', 'rs']:
                        text += f"\n--- File: {filename} ---\n"
                        text += f.read().decode("utf-8", errors="ignore") + "\n"
    except Exception as e:
        handle_file_processing_error("rar", e)
    return text

def extract_text_from_sql(sql_file):
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as temp_file:
            temp_file.write(sql_file.read())
            temp_path = temp_file.name
        conn = sqlite3.connect(temp_path)
        text = ""
        tables = pd.read_sql_query("SELECT name FROM sqlite_master WHERE type='table';", conn)
        for table in tables['name']:
            text += f"Table: {table}\n"
            text += pd.read_sql_query(f"SELECT * FROM {table} LIMIT 5", conn).to_string() + "\n\n"
        conn.close()
        try:
            os.remove(temp_path)
        except Exception:
            pass
        return text
    except Exception as e:
        handle_file_processing_error("sql", e)
        return ""

def extract_text_from_audio(audio_file):
    recognizer = sr.Recognizer()
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
            temp_file.write(audio_file.read())
            temp_path = temp_file.name
        with sr.AudioFile(temp_path) as source:
            audio = recognizer.record(source)
        text = recognizer.recognize_google(audio)
        try:
            os.remove(temp_path)
        except Exception:
            pass
        return text
    except sr.UnknownValueError:
        return "Speech recognition could not understand the audio"
    except sr.RequestError:
        return "Could not request results from speech recognition service"
    except Exception as e:
        handle_file_processing_error("audio", e)
        return ""

# Map extensions to extraction functions
EXTRACTION_FUNCTIONS = {
    "pdf": extract_text_from_pdf,
    "pptx": extract_text_from_ppt,
    "docx": extract_text_from_docx,
    "doc": extract_text_from_docx,
    "xls": extract_text_from_excel,
    "xlsx": extract_text_from_excel,
    "csv": extract_text_from_csv,
    "html": extract_text_from_html,
    "txt": extract_text_from_txt,
    "py": extract_text_from_txt,
    "js": extract_text_from_txt,
    "java": extract_text_from_txt,
    "c": extract_text_from_txt,
    "cpp": extract_text_from_txt,
    "rs": extract_text_from_txt,
    "xml": extract_text_from_xml,
    "md": extract_text_from_md,
    "zip": extract_text_from_zip,
    "rar": extract_text_from_rar,
    "db": extract_text_from_sql,
    "sql": extract_text_from_txt,
    "wav": extract_text_from_audio,
    "jpg": extract_text_from_image,
    "jpeg": extract_text_from_image,
    "png": extract_text_from_image,
    "bmp": extract_text_from_image,
}

def extract_text(file):
    file_extension = file.name.split(".")[-1].lower()
    extractor = EXTRACTION_FUNCTIONS.get(file_extension)
    if extractor:
        return extractor(file)
    else:
        st.warning(f"Unsupported file format: .{file_extension}")
        return ""

def main():
    st.set_page_config(page_title="M.A.R.S 🚀", layout="wide")
    apply_premium_styles()

    # Sidebar: Configurations and API Key
    st.sidebar.markdown("<h2 style='text-align: center;'>Config Settings</h2>", unsafe_allow_html=True)
    
    # API Key Input
    api_key_input = st.sidebar.text_input(
        "Google API Key",
        value=os.environ.get("GOOGLE_API_KEY", GOOGLE_API_KEY),
        type="password",
        help="Provide your Gemini Google API Key here."
    )
    if api_key_input:
        os.environ["GOOGLE_API_KEY"] = api_key_input
    
    # Model Selection
    use_ollama = st.sidebar.checkbox("Use Ollama (offline) instead of Gemini")
    ollama_model = "llama2"
    if use_ollama:
        ollama_model = st.sidebar.text_input("Ollama Model Name", value="llama2")
    
    # File Uploader
    st.sidebar.markdown("---")
    st.sidebar.markdown("<h3>Upload Files</h3>", unsafe_allow_html=True)
    uploaded_files = st.sidebar.file_uploader(
        "Upload files for multimodal research",
        accept_multiple_files=True
    )

    # Main Area Layout
    st.markdown("<h1>Multi-modal AI Research System (mMARS) 🚀</h1>", unsafe_allow_html=True)
    st.markdown("<p style='font-size: 16px; color: #94A3B8;'>Extract, analyze, and consult intelligence from any media or document format instantly.</p>", unsafe_allow_html=True)
    
    # Dashboard Tabs
    tab_chat, tab_preview, tab_formats = st.tabs(["💬 Chat Workspace", "📄 Document Text Preview", "📂 Supported Formats"])

    # Supported Formats tab
    with tab_formats:
        st.markdown("<div class='glass-card'>", unsafe_allow_html=True)
        st.markdown("<h3>Supported File Layouts</h3>", unsafe_allow_html=True)
        st.markdown("<p>mMARS integrates multiple AI models and scrapers to process:</p>", unsafe_allow_html=True)
        
        formats = sorted(list(EXTRACTION_FUNCTIONS.keys()))
        badges_html = "".join([f"<span class='format-tag'>.{f.upper()}</span>" for f in formats])
        st.markdown(badges_html, unsafe_allow_html=True)
        st.markdown("</div>", unsafe_allow_html=True)

    # File Processing logic
    raw_text = ""
    if uploaded_files:
        with st.spinner("Extracting and vectorizing data..."):
            extracted_texts = []
            for file in uploaded_files:
                txt = extract_text(file)
                if txt:
                    extracted_texts.append(f"=== Content from {file.name} ===\n{txt}\n")
            raw_text = "\n".join(extracted_texts)

    # Preview Tab
    with tab_preview:
        st.markdown("<div class='glass-card'>", unsafe_allow_html=True)
        if raw_text:
            st.markdown("<h3>Extracted Plain Text</h3>", unsafe_allow_html=True)
            st.text_area("Source text fed to the LLM context", value=raw_text, height=400)
        else:
            st.info("No documents uploaded yet, or no text extracted. Upload files in the sidebar to preview extracted content.")
        st.markdown("</div>", unsafe_allow_html=True)

    # Chat Workspace tab
    with tab_chat:
        st.markdown("<div class='glass-card'>", unsafe_allow_html=True)
        if not raw_text:
            st.info("👈 Upload your files in the sidebar to initialize the AI model.")
        else:
            # Check if we need to initialize or rebuild the vector store
            # To avoid rebuilds on every session update, save the hash of uploaded files
            files_hash = hash(tuple(f.name for f in uploaded_files))
            
            if "files_hash" not in st.session_state or st.session_state.files_hash != files_hash:
                st.session_state.files_hash = files_hash
                st.session_state.chat_history = []
                
                # Split text
                text_splitter = RecursiveCharacterTextSplitter(chunk_size=1024, chunk_overlap=256)
                chunks = text_splitter.split_text(raw_text)
                
                if chunks:
                    try:
                        # Embedding setup
                        if use_ollama:
                            embeddings = OllamaEmbeddings(model=ollama_model)
                            llm = ChatOllama(model=ollama_model)
                        else:
                            if not os.environ.get("GOOGLE_API_KEY"):
                                st.error("Google API Key is missing. Please provide it in the sidebar.")
                                return
                            embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
                            llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", temperature=0.3)
                        
                        # Build FAISS Store
                        vector_store = FAISS.from_texts(chunks, embedding=embeddings)
                        
                        # Conversation memory
                        memory = ConversationBufferMemory(
                            memory_key="chat_history", 
                            return_messages=True,
                            output_key="answer"
                        )
                        
                        # Conversation Chain
                        st.session_state.conversation = ConversationalRetrievalChain.from_llm(
                            llm=llm,
                            retriever=vector_store.as_retriever(),
                            memory=memory,
                            return_source_documents=True
                        )
                        st.success("AI brain built successfully! Ask anything below.")
                    except Exception as e:
                        st.error(f"Error building AI workspace: {e}")
                        st.session_state.conversation = None
                else:
                    st.warning("Could not extract any content to build the conversational context.")
            
            # Chat Display
            if "chat_history" not in st.session_state:
                st.session_state.chat_history = []
            
            # Display past messages
            for msg in st.session_state.chat_history:
                bubble_class = "chat-bubble-user" if msg["role"] == "user" else "chat-bubble-ai"
                st.markdown(f"<div class='chat-bubble {bubble_class}'><b>{msg['role'].upper()}:</b> {msg['content']}</div>", unsafe_allow_html=True)
            
            # User input
            user_question = st.chat_input("Ask a question about the uploaded documents:")
            if user_question:
                # Append user question
                st.session_state.chat_history.append({"role": "user", "content": user_question})
                st.markdown(f"<div class='chat-bubble chat-bubble-user'><b>USER:</b> {user_question}</div>", unsafe_allow_html=True)
                
                # Query RAG chain
                if "conversation" in st.session_state and st.session_state.conversation:
                    with st.spinner("Analyzing and thinking..."):
                        try:
                            response = st.session_state.conversation({"question": user_question})
                            answer = response["answer"]
                            
                            # Append and show AI answer
                            st.session_state.chat_history.append({"role": "assistant", "content": answer})
                            st.markdown(f"<div class='chat-bubble chat-bubble-ai'><b>AI:</b> {answer}</div>", unsafe_allow_html=True)
                            st.rerun() # Refresh chat interface to update UI state
                        except Exception as e:
                            st.error(f"Error querying Gemini: {e}")
                else:
                    st.error("RAG chain not initialized. Please verify configuration or API keys.")
        st.markdown("</div>", unsafe_allow_html=True)

if __name__ == "__main__":
    main()
