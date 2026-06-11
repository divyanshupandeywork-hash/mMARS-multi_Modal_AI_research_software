import streamlit as st
import os
from PyPDF2 import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_ollama import OllamaEmbeddings, ChatOllama
from langchain_community.vectorstores import FAISS
from langchain_classic.chains import ConversationalRetrievalChain
from langchain_classic.memory import ConversationBufferMemory

# Try loading API key from config if exists
try:
    from config import GOOGLE_API_KEY
    if GOOGLE_API_KEY:
        os.environ['GOOGLE_API_KEY'] = GOOGLE_API_KEY
except ImportError:
    pass

try:
    if "GOOGLE_API_KEY" in st.secrets:
        os.environ['GOOGLE_API_KEY'] = st.secrets["GOOGLE_API_KEY"]
except Exception:
    pass

def apply_styles():
    st.markdown("""
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Inter:wght@300;400;600&display=swap');
        html, body, [class*="css"] { font-family: 'Inter', sans-serif; }
        h1, h2, h3 {
            font-family: 'Outfit', sans-serif;
            font-weight: 800;
            background: linear-gradient(135deg, #FF4B4B 0%, #FF8F8F 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .glass-card {
            background: rgba(255, 255, 255, 0.03);
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 24px;
            margin-bottom: 24px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
        }
    </style>
    """, unsafe_allow_html=True)

def extract_text_from_pdf(pdf_file):
    text = ""
    pdf_reader = PdfReader(pdf_file)
    for page in pdf_reader.pages:
        content = page.extract_text()
        if content:
            text += content + "\n"
    return text

def get_text_chunks(text):
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1024, chunk_overlap=256)
    return text_splitter.split_text(text)

def get_vector_store(text_chunks, use_ollama, ollama_model):
    embeddings = OllamaEmbeddings(model=ollama_model) if use_ollama else GoogleGenerativeAIEmbeddings(model="models/embedding-001")
    return FAISS.from_texts(text_chunks, embedding=embeddings)

def get_conversation_chain(vector_store, use_ollama, ollama_model):
    llm = ChatOllama(model=ollama_model) if use_ollama else ChatGoogleGenerativeAI(model="gemini-1.5-flash", temperature=0.3)
    memory = ConversationBufferMemory(memory_key="chat_history", return_messages=True)
    return ConversationalRetrievalChain.from_llm(
        llm=llm, retriever=vector_store.as_retriever(), memory=memory
    )

def main():
    st.set_page_config(page_title="Chat with PDF", layout="wide")
    apply_styles()
    st.header("Chat with PDF 📄")

    st.sidebar.markdown("### Settings")
    api_key_input = st.sidebar.text_input("Google API Key", value=os.environ.get("GOOGLE_API_KEY", ""), type="password")
    if api_key_input:
        os.environ["GOOGLE_API_KEY"] = api_key_input

    use_ollama = st.sidebar.checkbox("Use Ollama (offline) instead of Gemini")
    ollama_model = st.sidebar.text_input("Ollama Model Name", value="llama2") if use_ollama else "llama2"

    pdf_file = st.file_uploader("Upload your PDF file", type="pdf")

    if pdf_file:
        st.markdown("<div class='glass-card'>", unsafe_allow_html=True)
        with st.spinner("Extracting text from PDF..."):
            text = extract_text_from_pdf(pdf_file)
        
        if text.strip():
            st.success("Extracted text successfully!")
            text_chunks = get_text_chunks(text)
            try:
                vector_store = get_vector_store(text_chunks, use_ollama, ollama_model)
                conversation = get_conversation_chain(vector_store, use_ollama, ollama_model)

                user_question = st.text_input("Ask a question about your PDF:")
                if user_question:
                    with st.spinner("Thinking..."):
                        response = conversation({'question': user_question})
                        st.write("Response:", response['answer'])
            except Exception as e:
                st.error(f"Error: {e}")
        else:
            st.warning("Could not extract any text from the PDF file.")
        st.markdown("</div>", unsafe_allow_html=True)

if __name__ == "__main__":
    main()
