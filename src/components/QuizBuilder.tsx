// src/components/QuizBuilder.tsx
import React, { useState } from 'react';
import { 
  Container, Typography, TextField, Button, MenuItem, Card, CardContent, IconButton 
} from '@mui/material';

import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import * as pdfjsLib from 'pdfjs-dist';

// Configuration du worker PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js`;

interface QuizQuestion {
  id: string;
  title: string;
  description: string;
  type: 'courte' | 'longue' | 'note5';
}

interface QuizParams {
  difficulty: 'facile' | 'moyen' | 'difficile';
  questionCount: number;
}

interface QuizData {
  title: string;
  questions: QuizQuestion[];
}

/* ------------------------------------------------------------------
   Fonction utilitaire pour réordonner un tableau 
   après un drag & drop
------------------------------------------------------------------ */
function reorder(list: QuizQuestion[], startIndex: number, endIndex: number): QuizQuestion[] {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}

/* ------------------------------------------------------------------
   Lecture / parsing du PDF en front
------------------------------------------------------------------ */
async function parsePdf(file: File): Promise<string> {
  const fileReader = new FileReader();
  return new Promise((resolve, reject) => {
    fileReader.onload = async function () {
      const typedarray = new Uint8Array(this.result as ArrayBuffer);
      try {
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        
        let extractedText = "";
        for (let i = 0; i < pdf.numPages; i++) {
          const page = await pdf.getPage(i + 1);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(" ")
            .trim();
          extractedText += pageText + "\n";
        }
        
        if (!extractedText.trim()) {
          console.warn('Aucun texte extrait du PDF');
        }
        
        resolve(extractedText);
      } catch (err) {
        console.error('Erreur lors de l\'extraction du texte:', err);
        reject(err);
      }
    };
    fileReader.onerror = (err) => {
      console.error('Erreur lors de la lecture du fichier:', err);
      reject(err);
    };
    fileReader.readAsArrayBuffer(file);
  });
}

/* ------------------------------------------------------------------
   Appel simplifié à GPT via fetch
------------------------------------------------------------------ */
async function generateQuizWithGPT(
  gptToken: string,
  pdfText: string,
  quizParams: QuizParams
): Promise<QuizData> {
  if (!gptToken) {
    throw new Error('GPT Token is missing!');
  }

  const systemPrompt = `Tu es un générateur de quiz. 
    L'utilisateur te fournit un texte PDF. 
    Crée un quiz de difficulté ${quizParams.difficulty}, 
    avec ${quizParams.questionCount} questions maximum, 
    chaque question ayant un type (courte, longue, note5). 
    Retourne un JSON strict avec un champ "title" et un champ "questions". 
    Chaque question a: id, title, description, type.`;

  const userContent = `CONTENU PDF: ${pdfText}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gptToken}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`Erreur API GPT: ${response.status} - ${response.statusText}`);
  }

  const data = await response.json();
  console.log(data);
  const content: string = data.choices[0].message.content;
  
  // Extraction du JSON du bloc de code markdown
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch) {
    throw new Error('Format de réponse GPT invalide');
  }
  const jsonContent = jsonMatch[1];

  let quiz: QuizData;
  try {
    quiz = JSON.parse(jsonContent);
    // Convertir les IDs numériques en chaînes et s'assurer qu'ils sont uniques
    quiz.questions = quiz.questions.map((q: any, index: number) => ({
      ...q,
      id: `question-${index}-${Date.now()}`
    }));
  } catch (err) {
    console.error('Erreur de parsing JSON:', err);
    throw new Error('Le JSON GPT est mal formaté.');
  }

  if (!quiz.title || !Array.isArray(quiz.questions)) {
    throw new Error("Le JSON GPT ne contient pas 'title' ou 'questions'.");
  }

  return quiz;
}

const QuizBuilder: React.FC = () => {
  // States
  const [gptToken, setGptToken] = useState<string>('');
  const [pdfText, setPdfText] = useState<string>('');
  const [pdfName, setPdfName] = useState<string>('');
  const [quizParams, setQuizParams] = useState<QuizParams>({
    difficulty: 'facile',
    questionCount: 5,
  });
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [quizTitle, setQuizTitle] = useState<string>('Mon Quiz Personnalisé');
  const [loading, setLoading] = useState<boolean>(false);

  /* ----------------------------------
     Drag & Drop : onDragEnd
  ---------------------------------- */
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) {
      return;
    }
    const items = Array.from(questions);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setQuestions(items);
  };

  /* ----------------------------------
     Upload PDF
  ---------------------------------- */
  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPdfName(file.name);
    console.log(file);
    try {
      const text = await parsePdf(file);
      console.log(text);
      setPdfText(text);
    } catch (err) {
      alert('Impossible de lire le PDF.');
    }
  };

  /* ----------------------------------
     Ajouter manuellement une question
  ---------------------------------- */
  const addQuestion = () => {
    const newQuestion: QuizQuestion = {
      id: `question-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: 'Nouvelle question',
      description: '',
      type: 'courte',
    };
    setQuestions([...questions, newQuestion]);
  };

  /* ----------------------------------
     Supprimer une question
  ---------------------------------- */
  const removeQuestion = (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  /* ----------------------------------
     Générer via GPT
  ---------------------------------- */
  const generateQuiz = async () => {
    if (!gptToken || !pdfText) {
      alert('Veuillez renseigner un token GPT et un PDF.');
      return;
    }
    setLoading(true);
    try {
      const quiz = await generateQuizWithGPT(gptToken, pdfText, quizParams);
      setQuestions(quiz.questions);
      setQuizTitle(quiz.title);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container style={{ marginTop: 20 }}>
      <Typography variant="h4" gutterBottom>
        Créateur de Quiz (Drag & Drop) - Hervé ANTONIO-MOTA
      </Typography>

      {/* Jeton GPT */}
      <div style={{ marginBottom: 16 }}>
        <TextField
          label="Jeton GPT"
          type="password"
          value={gptToken}
          onChange={(e) => setGptToken(e.target.value)}
          fullWidth
        />
      </div>

      {/* Uploader PDF */}
      <div style={{ marginBottom: 16 }}>
        <Button variant="outlined" component="label">
          {pdfName ? `PDF sélectionné : ${pdfName}` : 'Uploader un PDF'}
          <input
            type="file"
            accept="application/pdf"
            hidden
            onChange={handlePdfUpload}
          />
        </Button>
      </div>

      {/* Paramètres */}
      <div style={{ marginBottom: 16, display: 'flex', gap: '1rem' }}>
        <TextField
          select
          label="Difficulté"
          value={quizParams.difficulty}
          onChange={(e) =>
            setQuizParams({
              ...quizParams,
              difficulty: e.target.value as QuizParams['difficulty'],
            })
          }
          style={{ width: 150 }}
        >
          <MenuItem value="facile">Facile</MenuItem>
          <MenuItem value="moyen">Moyen</MenuItem>
          <MenuItem value="difficile">Difficile</MenuItem>
        </TextField>

        <TextField
          label="Nombre de questions"
          type="number"
          value={quizParams.questionCount}
          onChange={(e) =>
            setQuizParams({
              ...quizParams,
              questionCount: parseInt(e.target.value, 10) || 5,
            })
          }
          style={{ width: 150 }}
        />
      </div>

      {/* Bouton Génération GPT */}
      <Button
        variant="contained"
        onClick={generateQuiz}
        disabled={loading || !gptToken || !pdfText}
      >
        {loading ? 'Génération en cours...' : 'Générer le Quiz avec GPT'}
      </Button>

      <hr style={{ margin: '20px 0' }} />

      {/* Titre du quiz */}
      <TextField
        label="Titre du Quiz"
        value={quizTitle}
        onChange={(e) => setQuizTitle(e.target.value)}
        fullWidth
        style={{ marginBottom: 16 }}
      />

      {/* Bouton ajout question */}
      <Button variant="outlined" onClick={addQuestion} style={{ marginBottom: 16 }}>
        Ajouter une question manuellement
      </Button>

      {/* Zone de drag & drop */}
      <div style={{ marginTop: '20px' }}>
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="droppable-list">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                style={{
                  minHeight: '100px',
                  padding: '8px',
                  backgroundColor: '#f5f5f5'
                }}
              >
                {Array.isArray(questions) && questions.map((question, index) => (
                  <Draggable 
                    key={question.id} 
                    draggableId={question.id} 
                    index={index}
                  >
                    {(provided) => (
                      <Card
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        style={{
                          marginBottom: '8px',
                          ...provided.draggableProps.style
                        }}
                      >
                        <CardContent>
                          <TextField
                            label="Titre de la question"
                            value={question.title}
                            onChange={(e) => {
                              const newTitle = e.target.value;
                              setQuestions((prev) =>
                                prev.map((q) =>
                                  q.id === question.id ? { ...q, title: newTitle } : q
                                )
                              );
                            }}
                            fullWidth
                            style={{ marginBottom: 8 }}
                          />
                          <TextField
                            label="Description / Énoncé"
                            value={question.description}
                            onChange={(e) => {
                              const newDesc = e.target.value;
                              setQuestions((prev) =>
                                prev.map((q) =>
                                  q.id === question.id ? { ...q, description: newDesc } : q
                                )
                              );
                            }}
                            multiline
                            rows={2}
                            fullWidth
                            style={{ marginBottom: 8 }}
                          />

                          <TextField
                            select
                            label="Type"
                            value={question.type}
                            onChange={(e) => {
                              const newType = e.target.value as QuizQuestion['type'];
                              setQuestions((prev) =>
                                prev.map((q) =>
                                  q.id === question.id ? { ...q, type: newType } : q
                                )
                              );
                            }}
                            style={{ width: 120 }}
                          >
                            <MenuItem value="courte">Courte</MenuItem>
                            <MenuItem value="longue">Longue</MenuItem>
                            <MenuItem value="note5">Note /5</MenuItem>
                          </TextField>

                          <IconButton
                            aria-label="delete-question"
                            onClick={() => removeQuestion(question.id)}
                            style={{ float: 'right' }}
                          >
                            ✕
                          </IconButton>
                        </CardContent>
                      </Card>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </Container>
  );
};

export default QuizBuilder;