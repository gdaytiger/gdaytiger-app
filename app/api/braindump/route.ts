import { NextRequest, NextResponse } from 'next/server';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const PROJECTS_DB_ID = 'f7712afe4c7247d7b1690f2e1ecc1a0d';

export async function POST(req: NextRequest) {
  const { projectName, nextActions, ideaText } = await req.json();

  const headers = {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  const projectRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { database_id: PROJECTS_DB_ID },
      properties: {
        Name: { title: [{ text: { content: projectName } }] },
        Status: { select: { name: 'In Progress' } },
        'Next Action': { rich_text: [{ text: { content: nextActions.filter(Boolean).join(' → ') } }] },
        Notes: { rich_text: [{ text: { content: `From Brain Dump: "${ideaText}"` } }] },
      },
    }),
  });

  const project = await projectRes.json();

  if (project.object === 'error') {
    return NextResponse.json({ error: project.message }, { status: 400 });
  }

  await fetch(`https://api.notion.com/v1/blocks/${project.id}/children`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      children: nextActions.filter(Boolean).map((a: string) => ({
        type: 'to_do',
        to_do: { checked: false, rich_text: [{ text: { content: a } }] },
      })),
    }),
  });

  return NextResponse.json({ success: true, projectId: project.id });
}
