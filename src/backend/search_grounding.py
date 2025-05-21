import logging
from typing import List, Dict, TypedDict
from openai import AsyncAzureOpenAI
from data_model import DataModel
from prompts import SEARCH_QUERY_SYSTEM_PROMPT
from models import Message, SearchConfig, GroundingResults
from azure.search.documents.aio import SearchClient
from grounding_retriever import GroundingRetriever

logger = logging.getLogger("groundingapi")


class SearchGroundingRetriever(GroundingRetriever):

    def __init__(
        self,
        search_client: SearchClient,
        openai_client: AsyncAzureOpenAI,
        data_model: DataModel,
        chatcompletions_model_name: str,
    ):
        self.search_client = search_client
        self.openai_client = openai_client
        self.data_model = data_model
        self.chatcompletions_model_name = chatcompletions_model_name

    async def retrieve(
        self,
        user_message: str,
        chat_thread: List[Message],
        options: SearchConfig,
    ) -> GroundingResults:

        query = await self._generate_search_query(user_message, chat_thread)

        try:
            payload = self.data_model.create_search_payload(query, options)

            search_results = await self.search_client.search(
                search_text=payload["search"],
                top=payload["top"],
                vector_queries=payload["vector_queries"],
                query_type=payload.get("query_type", "simple"),
                select=payload["select"],
            )
        except Exception as e:
            raise Exception(f"Azure AI Search request failed: {str(e)}")

        results_list = []
        async for result in search_results:
            results_list.append(result)

        references = await self.data_model.collect_grounding_results(results_list)

        return {
            "references": references,
            "search_queries": [query],
        }

    async def _generate_search_query(
        self, user_message: str, chat_thread: List[Message]
    ) -> str:
        try:
            messages = [
                {"role": "user", "content": user_message},
                *chat_thread,
            ]

            response = await self.openai_client.chat.completions.create(
                model=self.chatcompletions_model_name,
                messages=[
                    {"role": "system", "content": SEARCH_QUERY_SYSTEM_PROMPT},
                    *messages,
                ],
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(
                f"Error while calling Azure OpenAI to generate a search query: {str(e)}"
            )

    async def _get_image_citations(
        self, ref_ids: List[str], grounding_results: GroundingResults
    ) -> List[dict]:
        return self._extract_citations(ref_ids, grounding_results)

    async def _get_text_citations(
        self, ref_ids: List[str], grounding_results: GroundingResults
    ) -> List[dict]:
        return self._extract_citations(ref_ids, grounding_results)

    def _extract_citations(
        self, ref_ids: List[str], grounding_results: GroundingResults
    ) -> List[dict]:
        if not ref_ids:
            return []

        references = {
            grounding_result["ref_id"]: grounding_result
            for grounding_result in grounding_results
        }
        extracted_citations = []
        for ref_id in ref_ids:
            if ref_id in references:
                ref = references[ref_id]
                extracted_citations.append(self.data_model.extract_citation(ref))
        return extracted_citations
